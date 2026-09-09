import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EntityManager } from 'typeorm';
import { GlAccount, GlAccountCode } from './entities/gl-account.entity';
import { GlJournalEntry } from './entities/gl-journal-entry.entity';
import { GlPosting, GlPostingDirection } from './entities/gl-posting.entity';
import { WalletType } from '../wallet-types/entities/wallet-type.entity';
import {
  GlPostingCreatedEvent,
  RealtimeEvent,
  WalletBalanceChangedEvent,
} from '../realtime/events';

export interface LedgerLeg {
  code: GlAccountCode;
  currencyId: string;
  direction: GlPostingDirection;
  amount: bigint;
  // Only set for a leg against a wallet-mapped account (CUSTOMER_WALLETS or
  // CREDIT_RECEIVABLE) — which specific wallet it belongs to, so
  // getWalletBalance can find it later. Null for a leg against a non-wallet
  // account (BANK_CASH, SETTLEMENT_CLEARING, FEE_REVENUE,
  // LEDGER_ADJUSTMENTS, REPOSITORY_ALLOCATIONS).
  walletId: string | null;
}

// A wallet-mapped leg needs both which wallet it's for (to tag the
// posting) and that wallet's type (to pick CUSTOMER_WALLETS vs
// CREDIT_RECEIVABLE and its currency) — every caller already has both from
// the same Wallet row, so this is just those two fields rather than the
// whole entity.
export interface WalletLegInput {
  id: string;
  walletType: WalletType;
}

// Double-entry postings alongside the Transaction ledger — see the GL
// accounts doc comment on GlAccountCode for what each account means. Every
// public method here takes the same EntityManager the caller is already
// inside (TransactionsService.run wraps every money movement in one DB
// transaction), so a posting can never exist without the balance change
// that produced it, or vice versa.
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
// recorded as a debit. getWalletBalance relies on this same rule running in
// reverse: summing CREDIT postings as positive and DEBIT as negative, for a
// given wallet, always reproduces its balance — there's no stored
// wallets.balance column anymore.
@Injectable()
export class LedgerService {
  private readonly accountCache = new Map<string, GlAccount>();

  constructor(private readonly eventEmitter: EventEmitter2) {}

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

  walletLeg(wallet: WalletLegInput, delta: bigint): LedgerLeg {
    return {
      code: this.walletAccountCode(wallet.walletType),
      currencyId: wallet.walletType.currencyId,
      direction: this.directionForWalletDelta(delta),
      amount: delta < 0n ? -delta : delta,
      walletId: wallet.id,
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

  // A wallet's derived balance — sum of every CREDIT posting tagged with
  // its id, minus every DEBIT — instead of a stored column. Callers that
  // already hold this wallet's row lock (SELECT ... FOR UPDATE via
  // WalletsService.lockById) are safe to treat this as current-and-about-
  // to-be-written: any other transaction touching the same wallet is
  // blocked on that same lock until this one commits.
  async getWalletBalance(
    manager: EntityManager,
    walletId: string,
  ): Promise<bigint> {
    const balances = await this.getWalletBalances(manager, [walletId]);
    return balances.get(walletId) ?? 0n;
  }

  // Batch form for list views (e.g. serializing every wallet a user owns) —
  // one query instead of one per wallet. Wallets with no postings at all
  // (brand new, never moved money) aren't in the returned map; callers
  // should default a missing entry to 0n, same as getWalletBalance does.
  async getWalletBalances(
    manager: EntityManager,
    walletIds: string[],
  ): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>();
    if (walletIds.length === 0) return result;

    const rows = await manager
      .createQueryBuilder(GlPosting, 'posting')
      .where('posting.walletId IN (:...walletIds)', { walletIds })
      .select('posting.walletId', 'walletId')
      .addSelect(
        `SUM(CASE WHEN posting.direction = 'CREDIT' THEN posting.amount ELSE -posting.amount END)`,
        'net',
      )
      .groupBy('posting.walletId')
      .getRawMany<{ walletId: string; net: string }>();

    for (const row of rows) {
      result.set(row.walletId, BigInt(row.net));
    }
    return result;
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

    const legsWithAccounts = await Promise.all(
      legs.map(async (leg) => ({
        leg,
        account: await this.getAccount(manager, leg.code, leg.currencyId),
      })),
    );
    const postings = legsWithAccounts.map(({ leg, account }) =>
      manager.create(GlPosting, {
        journalEntryId: entry.id,
        accountId: account.id,
        direction: leg.direction,
        amount: leg.amount.toString(),
        walletId: leg.walletId,
      }),
    );
    await manager.save(postings);

    this.emitRealtimeEvents(entry, description, legsWithAccounts);

    return entry;
  }

  // Fired from inside the caller's still-open DB transaction (every
  // postEntry caller wraps it in dataSource.transaction(...)), so in theory
  // an event here could outlive a transaction that later rolls back. This
  // is a monitoring feed, not the ledger of record — the /admin/gl/* REST
  // endpoints stay authoritative — and the window is tiny, so this is an
  // accepted trade-off rather than something worth a queryRunner-buffered
  // flush-on-commit right now.
  private emitRealtimeEvents(
    entry: GlJournalEntry,
    description: string,
    legsWithAccounts: Array<{ leg: LedgerLeg; account: GlAccount }>,
  ): void {
    const at = new Date().toISOString();

    const glPostingCreated: GlPostingCreatedEvent = {
      journalEntryId: entry.id,
      transactionId: entry.transactionId,
      description,
      postings: legsWithAccounts.map(({ leg, account }) => ({
        accountCode: account.code,
        walletId: leg.walletId,
        direction: leg.direction,
        amount: leg.amount.toString(),
      })),
      at,
    };
    this.eventEmitter.emit(RealtimeEvent.GL_POSTING_CREATED, glPostingCreated);

    for (const { leg } of legsWithAccounts) {
      if (!leg.walletId) continue;
      const signedDelta =
        leg.direction === GlPostingDirection.CREDIT ? leg.amount : -leg.amount;
      const walletBalanceChanged: WalletBalanceChangedEvent = {
        walletId: leg.walletId,
        delta: signedDelta.toString(),
        transactionId: entry.transactionId,
        description,
        at,
      };
      this.eventEmitter.emit(
        RealtimeEvent.WALLET_BALANCE_CHANGED,
        walletBalanceChanged,
      );
    }
  }

  // A single wallet's balance changed by a real cash movement at the bank
  // (a deposit landing, or a withdrawal's rail settlement actually
  // clearing) — the other leg is BANK_CASH or, if the rail settlement
  // didn't clear, SETTLEMENT_CLEARING.
  async postCashMovement(
    manager: EntityManager,
    transactionId: string,
    description: string,
    wallet: WalletLegInput,
    delta: bigint,
    cashAccountCode:
      GlAccountCode.BANK_CASH | GlAccountCode.SETTLEMENT_CLEARING,
  ): Promise<GlJournalEntry> {
    const walletLeg = this.walletLeg(wallet, delta);
    const cashLeg: LedgerLeg = {
      code: cashAccountCode,
      currencyId: wallet.walletType.currencyId,
      // The cash leg always moves opposite to the wallet leg — money
      // arriving credits the wallet and debits cash in (an asset increase
      // is a debit); money leaving debits the wallet and credits cash.
      direction:
        walletLeg.direction === GlPostingDirection.CREDIT
          ? GlPostingDirection.DEBIT
          : GlPostingDirection.CREDIT,
      amount: walletLeg.amount,
      walletId: null,
    };
    return this.postEntry(manager, {
      transactionId,
      description,
      legs: [walletLeg, cashLeg],
    });
  }

  // Same idea as postCashMovement, but for a single cash-in landing on
  // several wallets at once — an installment repayment whose fee/penalty/
  // unblock-fee slices are routed to their own dedicated sub-repositories
  // (see TransactionsService.creditFeeSplitLegs) alongside the principal
  // landing on the main repository. totalAmount must equal the sum of
  // walletCredits' amounts.
  async postCashInMultiLeg(
    manager: EntityManager,
    transactionId: string,
    description: string,
    cashAccountCode:
      GlAccountCode.BANK_CASH | GlAccountCode.SETTLEMENT_CLEARING,
    currencyId: string,
    totalAmount: bigint,
    walletCredits: Array<{ wallet: WalletLegInput; amount: bigint }>,
  ): Promise<GlJournalEntry> {
    const legs: LedgerLeg[] = [
      {
        code: cashAccountCode,
        currencyId,
        direction: GlPostingDirection.DEBIT,
        amount: totalAmount,
        walletId: null,
      },
      ...walletCredits
        .filter((c) => c.amount > 0n)
        .map((c) => this.walletLeg(c.wallet, c.amount)),
    ];
    return this.postEntry(manager, { transactionId, description, legs });
  }

  // A purely internal reallocation between two wallets (TRANSFER, or a
  // PURCHASE moving money from buyer to merchant) — no cash account
  // involved, both legs are wallet-mapped accounts.
  async postWalletToWallet(
    manager: EntityManager,
    transactionId: string,
    description: string,
    fromWallet: WalletLegInput,
    toWallet: WalletLegInput,
    amount: bigint,
  ): Promise<GlJournalEntry> {
    return this.postEntry(manager, {
      transactionId,
      description,
      legs: [
        this.walletLeg(fromWallet, -amount),
        this.walletLeg(toWallet, amount),
      ],
    });
  }

  // An admin ADJUSTMENT — not backed by a real cash movement, so the other
  // leg is the LEDGER_ADJUSTMENTS suspense account.
  async postAdjustment(
    manager: EntityManager,
    transactionId: string,
    description: string,
    wallet: WalletLegInput,
    delta: bigint,
  ): Promise<GlJournalEntry> {
    const walletLeg = this.walletLeg(wallet, delta);
    const suspenseLeg: LedgerLeg = {
      code: GlAccountCode.LEDGER_ADJUSTMENTS,
      currencyId: wallet.walletType.currencyId,
      direction:
        walletLeg.direction === GlPostingDirection.CREDIT
          ? GlPostingDirection.DEBIT
          : GlPostingDirection.CREDIT,
      amount: walletLeg.amount,
      walletId: null,
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
    debits: Array<{ wallet: WalletLegInput; amount: bigint }>,
    credits: Array<{ wallet: WalletLegInput; amount: bigint }>,
  ): LedgerLeg[] {
    return [
      ...debits
        .filter((d) => d.amount > 0n)
        .map((d) => this.walletLeg(d.wallet, -d.amount)),
      ...credits
        .filter((c) => c.amount > 0n)
        .map((c) => this.walletLeg(c.wallet, c.amount)),
    ];
  }

  async postMultiLeg(
    manager: EntityManager,
    transactionId: string,
    description: string,
    debits: Array<{ wallet: WalletLegInput; amount: bigint }>,
    credits: Array<{ wallet: WalletLegInput; amount: bigint }>,
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
    debits: Array<{ wallet: WalletLegInput; amount: bigint }>,
    credits: Array<{ wallet: WalletLegInput; amount: bigint }>,
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

  // A repository-backed CREDIT wallet's own balance now mirrors its real
  // movement too (see the DeriveWalletBalanceFromGl migration) — the
  // REPOSITORY's own account already carries the real money movement
  // (posted separately, wherever the caller resolved this wallet's
  // ledgerWalletType to the repository), so this is a second, independent,
  // self-balancing entry: the wallet's own leg for the exact same delta,
  // offset by the REPOSITORY_ALLOCATIONS plug account. A no-op when delta
  // is zero (e.g. a purchase a repository fully funds and fully spends in
  // the same step nets to zero on the credit wallet's own balance — see
  // TransactionsService.settleCreditFundedPurchase).
  async postRepositoryAllocationMirror(
    manager: EntityManager,
    transactionId: string,
    description: string,
    wallet: WalletLegInput,
    delta: bigint,
  ): Promise<GlJournalEntry | null> {
    if (delta === 0n) return null;
    const walletLeg = this.walletLeg(wallet, delta);
    const plugLeg: LedgerLeg = {
      code: GlAccountCode.REPOSITORY_ALLOCATIONS,
      currencyId: wallet.walletType.currencyId,
      direction:
        walletLeg.direction === GlPostingDirection.CREDIT
          ? GlPostingDirection.DEBIT
          : GlPostingDirection.CREDIT,
      amount: walletLeg.amount,
      walletId: null,
    };
    return this.postEntry(manager, {
      transactionId,
      description,
      legs: [walletLeg, plugLeg],
    });
  }
}
