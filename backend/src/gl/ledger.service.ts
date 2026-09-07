import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { GlAccount, GlAccountCode } from './entities/gl-account.entity';
import { GlJournalEntry } from './entities/gl-journal-entry.entity';
import { GlPosting, GlPostingDirection } from './entities/gl-posting.entity';
import { WalletType } from '../wallet-types/entities/wallet-type.entity';

export interface LedgerLeg {
  code: GlAccountCode;
  currencyId: string;
  direction: GlPostingDirection;
  amount: bigint;
}

// Double-entry postings alongside the existing wallet-balance/Transaction
// ledger — see the GL accounts doc comment on GlAccountCode for what each
// account means. Every public method here takes the same EntityManager the
// caller is already inside (TransactionsService.run wraps every money
// movement in one DB transaction), so a posting can never exist without the
// balance change that produced it, or vice versa.
//
// Which GL account a wallet maps to depends on its type's law
// (allowNegativeBalance), not on the Transaction's type — a CREDIT wallet's
// balance is a receivable (asset) from Packeta's point of view, everything
// else is a liability. With accounts chosen this way, a single rule covers
// both: a wallet balance *increase* is always a CREDIT to its mapped
// account, and a *decrease* is always a DEBIT — for a liability that's the
// standard "credit increases it" rule, and for the receivable it holds too,
// because a CREDIT wallet's balance moving down means more is owed to
// Packeta, i.e. the receivable (an asset) is increasing, which is also
// recorded as a debit.
@Injectable()
export class LedgerService {
  private readonly accountCache = new Map<string, GlAccount>();

  walletAccountCode(walletType: WalletType): GlAccountCode {
    return walletType.allowNegativeBalance
      ? GlAccountCode.CREDIT_RECEIVABLE
      : GlAccountCode.CUSTOMER_WALLETS;
  }

  // delta > 0 (balance went up) -> CREDIT the wallet's mapped account;
  // delta < 0 -> DEBIT it. See the class comment for why this single rule
  // is correct for both liability and receivable accounts.
  directionForWalletDelta(delta: bigint): GlPostingDirection {
    return delta > 0n ? GlPostingDirection.CREDIT : GlPostingDirection.DEBIT;
  }

  walletLeg(walletType: WalletType, delta: bigint): LedgerLeg {
    return {
      code: this.walletAccountCode(walletType),
      currencyId: walletType.currencyId,
      direction: this.directionForWalletDelta(delta),
      amount: delta < 0n ? -delta : delta,
    };
  }

  async getAccount(
    manager: EntityManager,
    code: GlAccountCode,
    currencyId: string,
  ): Promise<GlAccount> {
    const cacheKey = `${code}:${currencyId}`;
    const cached = this.accountCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const account = await manager.findOne(GlAccount, {
      where: { code, currencyId },
    });
    if (!account) {
      throw new Error(
        `No GL account seeded for ${code} in currency ${currencyId}`,
      );
    }
    this.accountCache.set(cacheKey, account);
    return account;
  }

  // Inserts a balanced journal entry. Throws if the legs don't net to zero
  // per currency — a bug here should fail the whole DB transaction (and
  // therefore the money movement that triggered it) rather than silently
  // produce an unbalanced ledger.
  async postEntry(
    manager: EntityManager,
    params: {
      transactionId: string;
      description: string;
      legs: LedgerLeg[];
      reversalOfId?: string;
    },
  ): Promise<GlJournalEntry> {
    const { transactionId, description, legs, reversalOfId } = params;
    if (legs.length < 2) {
      throw new Error('A journal entry needs at least two legs');
    }

    const totalsByCurrency = new Map<string, bigint>();
    for (const leg of legs) {
      if (leg.amount <= 0n) {
        throw new Error('Journal entry legs must have a positive amount');
      }
      const signed =
        leg.direction === GlPostingDirection.DEBIT ? leg.amount : -leg.amount;
      totalsByCurrency.set(
        leg.currencyId,
        (totalsByCurrency.get(leg.currencyId) ?? 0n) + signed,
      );
    }
    for (const [currencyId, total] of totalsByCurrency) {
      if (total !== 0n) {
        throw new Error(
          `Unbalanced journal entry for currency ${currencyId}: debits and credits differ by ${total}`,
        );
      }
    }

    const entry = manager.create(GlJournalEntry, {
      transactionId,
      description,
      reversalOfId: reversalOfId ?? null,
    });
    await manager.save(entry);

    const postings = await Promise.all(
      legs.map(async (leg) => {
        const account = await this.getAccount(manager, leg.code, leg.currencyId);
        return manager.create(GlPosting, {
          journalEntryId: entry.id,
          accountId: account.id,
          direction: leg.direction,
          amount: leg.amount.toString(),
        });
      }),
    );
    await manager.save(postings);

    return entry;
  }

  // A single wallet's balance changed by a real cash movement at the bank
  // (a deposit landing, or a withdrawal's rail settlement actually
  // clearing) — the other leg is BANK_CASH or, if the rail settlement
  // didn't clear, SETTLEMENT_CLEARING.
  async postCashMovement(
    manager: EntityManager,
    transactionId: string,
    description: string,
    walletType: WalletType,
    delta: bigint,
    cashAccountCode: GlAccountCode.BANK_CASH | GlAccountCode.SETTLEMENT_CLEARING,
  ): Promise<GlJournalEntry> {
    const walletLeg = this.walletLeg(walletType, delta);
    const cashLeg: LedgerLeg = {
      code: cashAccountCode,
      currencyId: walletType.currencyId,
      // The cash leg always moves opposite to the wallet leg — money
      // arriving credits the wallet and debits cash in (an asset increase
      // is a debit); money leaving debits the wallet and credits cash.
      direction:
        walletLeg.direction === GlPostingDirection.CREDIT
          ? GlPostingDirection.DEBIT
          : GlPostingDirection.CREDIT,
      amount: walletLeg.amount,
    };
    return this.postEntry(manager, {
      transactionId,
      description,
      legs: [walletLeg, cashLeg],
    });
  }

  // A purely internal reallocation between two wallets (TRANSFER, or a
  // PURCHASE moving money from buyer to merchant) — no cash account
  // involved, both legs are wallet-mapped accounts.
  async postWalletToWallet(
    manager: EntityManager,
    transactionId: string,
    description: string,
    fromWalletType: WalletType,
    toWalletType: WalletType,
    amount: bigint,
  ): Promise<GlJournalEntry> {
    return this.postEntry(manager, {
      transactionId,
      description,
      legs: [
        this.walletLeg(fromWalletType, -amount),
        this.walletLeg(toWalletType, amount),
      ],
    });
  }

  // An admin ADJUSTMENT — not backed by a real cash movement, so the other
  // leg is the LEDGER_ADJUSTMENTS suspense account.
  async postAdjustment(
    manager: EntityManager,
    transactionId: string,
    description: string,
    walletType: WalletType,
    delta: bigint,
  ): Promise<GlJournalEntry> {
    const walletLeg = this.walletLeg(walletType, delta);
    const suspenseLeg: LedgerLeg = {
      code: GlAccountCode.LEDGER_ADJUSTMENTS,
      currencyId: walletType.currencyId,
      direction:
        walletLeg.direction === GlPostingDirection.CREDIT
          ? GlPostingDirection.DEBIT
          : GlPostingDirection.CREDIT,
      amount: walletLeg.amount,
    };
    return this.postEntry(manager, {
      transactionId,
      description,
      legs: [walletLeg, suspenseLeg],
    });
  }

  // General multi-leg entry: several wallets debited, several credited (or
  // vice versa) — a purchase that draws on more than one funding source
  // (the wallet's own balance, a support top-up, a backing repository) to
  // pay a single merchant, or a refund that pays a single merchant's debit
  // back out to more than one destination. Zero-amount legs are dropped
  // rather than rejected, since callers build these from optional funding
  // sources that may not have applied (e.g. a purchase with no repository
  // funding at all).
  private multiLegs(
    debits: Array<{ walletType: WalletType; amount: bigint }>,
    credits: Array<{ walletType: WalletType; amount: bigint }>,
  ): LedgerLeg[] {
    return [
      ...debits
        .filter((d) => d.amount > 0n)
        .map((d) => this.walletLeg(d.walletType, -d.amount)),
      ...credits
        .filter((c) => c.amount > 0n)
        .map((c) => this.walletLeg(c.walletType, c.amount)),
    ];
  }

  async postMultiLeg(
    manager: EntityManager,
    transactionId: string,
    description: string,
    debits: Array<{ walletType: WalletType; amount: bigint }>,
    credits: Array<{ walletType: WalletType; amount: bigint }>,
  ): Promise<GlJournalEntry> {
    return this.postEntry(manager, {
      transactionId,
      description,
      legs: this.multiLegs(debits, credits),
    });
  }

  // Same as postMultiLeg, but links back to the journal entry originally
  // posted for originalTransactionId (if one exists) via reversalOfId — a
  // refund undoing a purchase that predates this feature, or one of the
  // not-yet-wired flows, simply won't have an original to link to, which is
  // fine (reversalOfId is nullable).
  async postReversal(
    manager: EntityManager,
    originalTransactionId: string,
    reversalTransactionId: string,
    description: string,
    debits: Array<{ walletType: WalletType; amount: bigint }>,
    credits: Array<{ walletType: WalletType; amount: bigint }>,
  ): Promise<GlJournalEntry> {
    const original = await manager.findOne(GlJournalEntry, {
      where: { transactionId: originalTransactionId },
    });
    return this.postEntry(manager, {
      transactionId: reversalTransactionId,
      description,
      legs: this.multiLegs(debits, credits),
      reversalOfId: original?.id,
    });
  }
}
