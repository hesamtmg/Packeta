import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import {
  SettlementSplit,
  SettlementSplitType,
} from './entities/settlement-split.entity';
import { SettlementAccountDto } from './dto/settlement-account.dto';
import { SettlementSplitDto } from './dto/settlement-split.dto';

// A percent-based split set must land on exactly 100 — floating point makes
// "exactly" impractical, so sums within this tolerance are accepted.
const PERCENT_TOLERANCE = 0.01;

export interface SettlementAmount {
  iban: string;
  label: string | null;
  amount: bigint;
}

@Injectable()
export class SettlementService {
  constructor(
    @InjectRepository(SettlementSplit)
    private readonly settlementSplitsRepository: Repository<SettlementSplit>,
  ) {}

  // Wallet-level defaults are always percent-based (see SettlementAccountDto)
  // and must add up to exactly 100% — a partial default would leave every
  // future purchase's settlement amount ambiguous.
  validateWalletDefaults(items: SettlementAccountDto[]): void {
    if (!items.length) {
      throw new BadRequestException('settlementAccounts must not be empty');
    }
    const sum = items.reduce((total, item) => total + item.percent, 0);
    if (Math.abs(sum - 100) > PERCENT_TOLERANCE) {
      throw new BadRequestException(
        `settlementAccounts percentages must add up to 100 (got ${sum})`,
      );
    }
  }

  // Per-charge overrides may be percent (sum to 100%) or fixed (sum to
  // exactly the charge's own amount) — but not mixed within one charge,
  // since "percent of what's left after fixed deductions" is ambiguous.
  validateChargeOverrides(items: SettlementSplitDto[], amount: number): void {
    if (!items.length) {
      throw new BadRequestException('settlementSplits must not be empty');
    }
    const types = new Set(items.map((item) => item.type));
    if (types.size > 1) {
      throw new BadRequestException(
        'settlementSplits must all use the same type — either all PERCENT or all FIXED',
      );
    }
    const type = items[0].type;
    const sum = items.reduce((total, item) => total + item.value, 0);
    if (type === 'PERCENT') {
      if (Math.abs(sum - 100) > PERCENT_TOLERANCE) {
        throw new BadRequestException(
          `settlementSplits percentages must add up to 100 (got ${sum})`,
        );
      }
    } else {
      if (Math.round(sum) !== amount) {
        throw new BadRequestException(
          `settlementSplits fixed amounts must add up to the charge amount ${amount} (got ${sum})`,
        );
      }
    }
  }

  async createForWallet(
    manager: EntityManager,
    walletId: string,
    items: SettlementAccountDto[],
  ): Promise<void> {
    const rows = items.map((item, index) =>
      manager.create(SettlementSplit, {
        walletId,
        transactionId: null,
        iban: item.iban,
        label: item.label ?? null,
        splitType: SettlementSplitType.PERCENT,
        percentValue: item.percent.toString(),
        fixedAmount: null,
        sortOrder: index,
      }),
    );
    await manager.save(rows);
  }

  async createForTransaction(
    manager: EntityManager,
    transactionId: string,
    items: SettlementSplitDto[],
  ): Promise<void> {
    const isPercent = items[0].type === 'PERCENT';
    const rows = items.map((item, index) =>
      manager.create(SettlementSplit, {
        walletId: null,
        transactionId,
        iban: item.iban,
        label: item.label ?? null,
        splitType: isPercent
          ? SettlementSplitType.PERCENT
          : SettlementSplitType.FIXED,
        percentValue: isPercent ? item.value.toString() : null,
        fixedAmount: isPercent ? null : Math.round(item.value).toString(),
        sortOrder: index,
      }),
    );
    await manager.save(rows);
  }

  async findForWallet(
    manager: EntityManager,
    walletId: string,
  ): Promise<SettlementSplit[]> {
    return manager.find(SettlementSplit, {
      where: { walletId },
      order: { sortOrder: 'ASC' },
    });
  }

  // Bulk lookup for the sweep: every per-charge override for a batch of
  // unsettled purchase transactions, grouped by transactionId — avoids one
  // query per purchase.
  async findForTransactions(
    manager: EntityManager,
    transactionIds: string[],
  ): Promise<Map<string, SettlementSplit[]>> {
    const map = new Map<string, SettlementSplit[]>();
    if (!transactionIds.length) {
      return map;
    }
    const rows = await manager.find(SettlementSplit, {
      where: { transactionId: In(transactionIds) },
      order: { sortOrder: 'ASC' },
    });
    for (const row of rows) {
      const list = map.get(row.transactionId!) ?? [];
      list.push(row);
      map.set(row.transactionId!, list);
    }
    return map;
  }

  // Splits a total amount across a (homogeneous) split set so the pieces
  // always sum to exactly `totalAmount` — for PERCENT rows, every item but
  // the last is floored, and the last absorbs whatever rounding remainder is
  // left, rather than risking a sum that's a cent off in either direction.
  computeAmounts(
    rows: SettlementSplit[],
    totalAmount: string,
  ): SettlementAmount[] {
    const total = BigInt(totalAmount);
    if (rows[0].splitType === SettlementSplitType.FIXED) {
      return rows.map((row) => ({
        iban: row.iban,
        label: row.label,
        amount: BigInt(row.fixedAmount!),
      }));
    }

    const amounts: bigint[] = [];
    let allocated = 0n;
    for (let i = 0; i < rows.length - 1; i++) {
      const pctMilli = BigInt(Math.round(Number(rows[i].percentValue) * 1000));
      const amount = (total * pctMilli) / 100_000n;
      amounts.push(amount);
      allocated += amount;
    }
    amounts.push(total - allocated);

    return rows.map((row, i) => ({
      iban: row.iban,
      label: row.label,
      amount: amounts[i],
    }));
  }
}
