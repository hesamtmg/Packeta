import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Installment, InstallmentStatus } from './entities/installment.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import {
  Transaction,
  TransactionType,
} from '../transactions/entities/transaction.entity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Whole days between two date-only ("YYYY-MM-DD") strings. Both parse as UTC
// midnight, so the subtraction is exact with no timezone drift.
function daysBetween(earlier: string, later: string): number {
  const ms = Date.parse(later) - Date.parse(earlier);
  return Math.floor(ms / MS_PER_DAY);
}

// Adds `months` calendar months to `date`, clamped to `day` (1-31, clamped
// to the target month's actual last day — e.g. day 31 in a 30-day month
// becomes the 30th).
function dateForDayOfMonth(year: number, month: number, day: number): Date {
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDayOfMonth));
}

@Injectable()
export class InstallmentsService {
  constructor(
    @InjectRepository(Installment)
    private readonly installmentsRepository: Repository<Installment>,
    @InjectRepository(Wallet)
    private readonly walletsRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
  ) {}

  // Splits a billing period's total (the sum of a credit wallet's VIRTUAL
  // transactions over that period — see generateDue) into installmentCount
  // equal shares — the remainder, if any, folds into the last installment so
  // the total always reconciles exactly. This is the fee/penalty percentage
  // base (Installment.principalAmount), fixed at generation time.
  computeInstallmentPrincipal(
    periodTotal: bigint,
    installmentCount: number,
    sequenceNumber: number,
  ): bigint {
    const share = periodTotal / BigInt(installmentCount);
    const remainder = periodTotal % BigInt(installmentCount);
    const isLast = sequenceNumber === installmentCount;
    return share + (isLast ? remainder : 0n);
  }

  // `percent` is a decimal string (up to 3 decimal places, e.g. "2.500" for
  // 2.5%) as stored on WalletType.feePercent/penaltyPercentPerDay — scaled
  // through milli-percent (x1000) so the whole computation stays in BigInt,
  // same convention as SettlementService.computeAmounts.
  private percentOf(amount: bigint, percent: string | null): bigint {
    if (!percent) return 0n;
    const milliPercent = BigInt(Math.round(Number(percent) * 1000));
    return (amount * milliPercent) / 100_000n;
  }

  // The next unpaid-schedule installment's deadline: the type's
  // paymentDeadlineDate day-of-month, in the same month as dueDate if that
  // day hasn't passed yet, otherwise the following month.
  computeDeadlineDate(dueDate: Date, paymentDeadlineDate: number): Date {
    const candidate = dateForDayOfMonth(
      dueDate.getFullYear(),
      dueDate.getMonth(),
      paymentDeadlineDate,
    );
    if (candidate.getTime() <= dueDate.getTime()) {
      return dateForDayOfMonth(
        dueDate.getFullYear(),
        dueDate.getMonth() + 1,
        paymentDeadlineDate,
      );
    }
    return candidate;
  }

  // Once a month, on the day matching its type's installmentDate, every
  // repository-backed credit wallet gets a brand-new installmentCount-row
  // repayment plan (sequenceNumber 1..installmentCount, due this month,
  // +1 month, ... up to installmentCount-1 months later) covering exactly
  // what happened to *that wallet's own* virtualAmount over the one month
  // preceding today — its VIRTUAL transactions (see WalletsService
  // .grantCredit's grant, TransactionsService.settleCreditFundedPurchase's
  // draw-downs, and markPaid's restores below — all three touch this
  // wallet), not the repository's. Idempotent per period: skips a wallet
  // that already has a batch on record for a period ending today.
  //
  // The window is [oneMonthBefore(today), today) — a half-open interval so
  // consecutive months tile exactly, with no gap and no overlap; a
  // transaction landing exactly at today's boundary belongs to the next
  // period, not this one.
  async generateDue(today: Date = new Date()): Promise<Installment[]> {
    const dayOfMonth = today.getDate();
    const todayDate = toDateOnly(today);
    const periodStartAt = dateForDayOfMonth(
      today.getFullYear(),
      today.getMonth() - 1,
      today.getDate(),
    );
    const periodStart = toDateOnly(periodStartAt);

    const wallets = await this.walletsRepository
      .createQueryBuilder('wallet')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .where('wallet.repositoryWalletId IS NOT NULL')
      .andWhere('wallet.closedAt IS NULL')
      .andWhere('walletType.installmentDate = :dayOfMonth', { dayOfMonth })
      .andWhere('walletType.installmentCount IS NOT NULL')
      .getMany();

    const created: Installment[] = [];
    for (const wallet of wallets) {
      const installmentCount = wallet.walletType.installmentCount!;

      const alreadyGenerated = await this.installmentsRepository.find({
        where: { walletId: wallet.id, periodEnd: todayDate },
      });
      if (alreadyGenerated.length > 0) continue;

      const { total } = (await this.transactionsRepository
        .createQueryBuilder('t')
        .select('COALESCE(SUM(t.amount), 0)', 'total')
        .where('t.type = :type', { type: TransactionType.VIRTUAL })
        .andWhere('(t.fromWalletId = :walletId)', {
          walletId: wallet.id,
        })
        .andWhere('t.createdAt >= :periodStartAt', { periodStartAt })
        .andWhere('t.createdAt < :today', { today })
        .getRawOne()) ?? { total: '0' };
      const periodTotal = BigInt(total ?? '0');
      if (periodTotal <= 0n) continue;

      for (
        let sequenceNumber = 1;
        sequenceNumber <= installmentCount;
        sequenceNumber++
      ) {
        const principal = this.computeInstallmentPrincipal(
          periodTotal,
          installmentCount,
          sequenceNumber,
        );
        const fee = this.percentOf(principal, wallet.walletType.feePercent);
        const amount = principal + fee;
        const dueDateForSequence = dateForDayOfMonth(
          today.getFullYear(),
          today.getMonth() + (sequenceNumber - 1),
          today.getDate(),
        );
        const deadlineDate = wallet.walletType.paymentDeadlineDate
          ? this.computeDeadlineDate(
              dueDateForSequence,
              wallet.walletType.paymentDeadlineDate,
            )
          : dueDateForSequence;

        const installment = this.installmentsRepository.create({
          walletId: wallet.id,
          periodStart,
          periodEnd: todayDate,
          sequenceNumber,
          amount: amount.toString(),
          principalAmount: principal.toString(),
          dueDate: toDateOnly(dueDateForSequence),
          deadlineDate: toDateOnly(deadlineDate),
          status: InstallmentStatus.PENDING,
        });
        created.push(await this.installmentsRepository.save(installment));
      }
    }
    return created;
  }

  // Every still-unpaid installment past its deadline (PENDING transitioning
  // to OVERDUE, or already OVERDUE and still accruing): tops up `amount` by
  // penaltyPercentPerDay x principalAmount for each day elapsed since the
  // last time this ran that hasn't already been charged (penaltyDaysApplied
  // tracks that), marks it OVERDUE, and blocks its wallet from further
  // outgoing money movement until repaid. Safe to run more or less than once
  // a day — it always converges to "penaltyDaysApplied days worth of
  // penalty", never double-charging a day twice.
  async applyOverduePenalties(today: Date = new Date()): Promise<number> {
    const todayDate = toDateOnly(today);
    const unpaid = await this.installmentsRepository
      .createQueryBuilder('installment')
      .innerJoinAndSelect('installment.wallet', 'wallet')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .where('installment.status IN (:...statuses)', {
        statuses: [InstallmentStatus.PENDING, InstallmentStatus.OVERDUE],
      })
      .andWhere('installment.deadlineDate < :todayDate', { todayDate })
      .getMany();

    let affected = 0;
    for (const installment of unpaid) {
      const daysOverdue = daysBetween(installment.deadlineDate, todayDate);
      const owedDays = daysOverdue - installment.penaltyDaysApplied;
      if (owedDays <= 0 && installment.status === InstallmentStatus.OVERDUE) {
        continue;
      }

      if (owedDays > 0) {
        const dailyPenalty = this.percentOf(
          BigInt(installment.principalAmount),
          installment.wallet.walletType.penaltyPercentPerDay,
        );
        installment.amount = (
          BigInt(installment.amount) +
          dailyPenalty * BigInt(owedDays)
        ).toString();
        installment.penaltyDaysApplied = daysOverdue;
      }
      installment.penaltyApplied = true;
      installment.status = InstallmentStatus.OVERDUE;
      await this.installmentsRepository.save(installment);
      affected++;

      if (!installment.wallet.blockedAt) {
        await this.walletsRepository.update(installment.wallet.id, {
          blockedAt: new Date(),
        });
      }
    }
    return affected;
  }

  async findForWallet(
    userId: string,
    walletId: string,
  ): Promise<Installment[]> {
    const wallet = await this.walletsRepository.findOne({
      where: { id: walletId },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (wallet.userId !== userId) {
      throw new ForbiddenException('This wallet does not belong to you');
    }
    return this.installmentsRepository.find({
      where: { walletId },
      order: { sequenceNumber: 'ASC' },
    });
  }

  // Every installment across every credit wallet the caller owns.
  async findAllForUser(userId: string): Promise<Installment[]> {
    return this.installmentsRepository
      .createQueryBuilder('installment')
      .innerJoin('installment.wallet', 'wallet')
      .where('wallet.userId = :userId', { userId })
      .orderBy('installment.deadlineDate', 'ASC')
      .getMany();
  }

  // Admin-only: every installment across every credit wallet, any customer
  // — the admin panel's global view. Loads wallet + owner so the panel can
  // show whose installment it is without a second round trip per row.
  async findAll(): Promise<Installment[]> {
    return this.installmentsRepository
      .createQueryBuilder('installment')
      .innerJoinAndSelect('installment.wallet', 'wallet')
      .innerJoinAndSelect('wallet.user', 'user')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .innerJoinAndSelect('walletType.currency', 'currency')
      .orderBy('installment.deadlineDate', 'DESC')
      .getMany();
  }

  async getByIdForUser(
    userId: string,
    installmentId: string,
  ): Promise<Installment> {
    const installment = await this.installmentsRepository.findOne({
      where: { id: installmentId },
      relations: { wallet: { walletType: true } },
    });
    if (!installment) throw new NotFoundException('Installment not found');
    if (installment.wallet.userId !== userId) {
      throw new ForbiddenException('This installment does not belong to you');
    }
    return installment;
  }

  // Called from inside TransactionsService.verifyPurchase's transaction once
  // the repayment purchase completes: marks the installment PAID, and, if
  // its wallet was blocked, clears the block. Also restores the wallet's
  // virtualAmount (credit ceiling) by the installment's own amount — the
  // mirror image of the draw at spend time (see verifyPurchase's
  // WalletTypeCode.CREDIT branch), so repaying an installment frees up that
  // much credit to draw on again. Deliberately the installment's `amount`
  // alone, not any unblockFee folded into the charge (that's a penalty, not
  // principal) — the repository's real balance already gets the full
  // charge (amount + unblockFee) via verifyPurchase's generic
  // real-money-in crediting of toWallet before this runs.
  async markPaid(
    manager: EntityManager,
    installmentId: string,
    transactionId: string,
  ): Promise<void> {
    await manager.update(Installment, installmentId, {
      status: InstallmentStatus.PAID,
      paidAt: new Date(),
      paymentTransactionId: transactionId,
    });
    const installment = await manager.findOne(Installment, {
      where: { id: installmentId },
    });
    if (installment) {
      await manager.update(Wallet, installment.walletId, { blockedAt: null });
      const wallet = await manager.findOne(Wallet, {
        where: { id: installment.walletId },
      });
      if (wallet) {
        const restored =
          BigInt(wallet.virtualAmount ?? '0') + BigInt(installment.amount);
        await manager.update(Wallet, wallet.id, {
          virtualAmount: restored.toString(),
        });
        // Mirror image of the VIRTUAL draw-down recorded at spend time (see
        // TransactionsService.settleCreditFundedPurchase) — its own ledger
        // row so the ceiling's ups and downs are all individually visible,
        // not just inferable from the wallet's current virtualAmount.
        const restoreTransaction = manager.create(Transaction, {
          type: TransactionType.VIRTUAL,
          fromWalletId: null,
          toWalletId: wallet.id,
          amount: installment.amount,
          idempotencyKey: `installment-restore:${installment.id}`,
          note: 'Credit wallet ceiling restored by installment repayment',
        });
        await manager.save(restoreTransaction);
      }
    }
  }
}
