import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppDataSource } from '../database/data-source';
import { Wallet } from '../wallets/entities/wallet.entity';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import {
  RailSettlement,
  RailSettlementStatus,
} from '../rail-settlements/entities/rail-settlement.entity';
import { GlJournalEntry } from '../gl/entities/gl-journal-entry.entity';
import { GlAccountCode } from '../gl/entities/gl-account.entity';
import { LedgerService, WalletLegInput } from '../gl/ledger.service';
import { EntityManager } from 'typeorm';

// One-off backfill: every Transaction row created before the GL feature
// shipped has no gl_journal_entries/gl_postings of its own. This derives
// them from the Transaction rows already on disk, using the exact same
// idempotencyKey conventions the live code writes (support-fund:,
// credit-fund:, repayment-split:, credit-fund-reverse:, overdue-absorb:,
// quit-absorb:, and the `:reversal` suffix) to recognize which rows are
// "child legs" of another row's single journal entry, rather than positing
// their own.
//
// Idempotent and resumable: each parent transaction gets its own small DB
// transaction, and is skipped if a gl_journal_entries row already exists
// for it (whether from an earlier backfill run or from having been created
// after the GL went live) — so this is safe to run against the whole table
// repeatedly, and safe to interrupt and re-run.
//
// Run with: npm run backfill-gl -- [--dry-run]
const DRY_RUN = process.argv.includes('--dry-run');

const CHILD_LEG_PATTERNS: RegExp[] = [
  /^support-fund:/,
  /^credit-fund:/,
  /^credit-fund-reverse:/,
  /^repayment-split:.*-(fee|penalty|unblock-fee)$/,
  /^overdue-absorb:.*-(fee|penalty|unblock-fee)$/,
  /^quit-absorb:.*-(fee|penalty)$/,
];

function isChildLeg(idempotencyKey: string): boolean {
  return CHILD_LEG_PATTERNS.some((p) => p.test(idempotencyKey));
}

// Mirrors TransactionsService.ledgerWalletLeg: a repository-backed CREDIT
// wallet's real cash movement is posted against its REPOSITORY's own id,
// not its own — the wallet's own balance is derived separately via a
// REPOSITORY_ALLOCATIONS mirror posting (see repositoryMirrorLeg below).
// Kept as a standalone copy here since instantiating the real
// TransactionsService would drag in its whole dependency graph for a
// one-time script.
function ledgerWalletLeg(
  wallet: Wallet,
  walletsById: Map<string, Wallet>,
): WalletLegInput {
  if (!wallet.repositoryWalletId) {
    return { id: wallet.id, walletType: wallet.walletType };
  }
  const repository = walletsById.get(wallet.repositoryWalletId);
  if (!repository) {
    throw new Error(
      `Wallet ${wallet.id} references missing repository ${wallet.repositoryWalletId}`,
    );
  }
  return { id: repository.id, walletType: repository.walletType };
}

function ownWalletLeg(wallet: Wallet): WalletLegInput {
  return { id: wallet.id, walletType: wallet.walletType };
}

interface Report {
  posted: Record<string, number>;
  skippedAlreadyPosted: number;
  skippedNoMoneyMoved: number;
  needsReview: Array<{ transactionId: string; reason: string }>;
}

function emptyReport(): Report {
  return {
    posted: {},
    skippedAlreadyPosted: 0,
    skippedNoMoneyMoved: 0,
    needsReview: [],
  };
}

async function main() {
  const dataSource = await AppDataSource.initialize();
  const ledger = new LedgerService(new EventEmitter2());
  const report = emptyReport();

  try {
    const wallets = await dataSource.getRepository(Wallet).find({
      relations: { walletType: { currency: true } },
    });
    const walletsById = new Map(wallets.map((w) => [w.id, w]));

    const transactions = await dataSource.getRepository(Transaction).find({
      order: { createdAt: 'ASC' },
    });
    const byId = new Map(transactions.map((t) => [t.id, t]));
    const byIdempotencyKey = new Map(
      transactions.map((t) => [t.idempotencyKey, t]),
    );
    const reversalMarkersByOriginalId = new Map<string, Transaction>();
    for (const t of transactions) {
      if (
        t.type === TransactionType.PURCHASE &&
        t.status === TransactionStatus.REVERSED &&
        t.relatedTransactionId
      ) {
        reversalMarkersByOriginalId.set(t.relatedTransactionId, t);
      }
    }

    const railSettlementsRepo = dataSource.getRepository(RailSettlement);
    const journalEntriesRepo = dataSource.getRepository(GlJournalEntry);

    const wallet = (id: string | null, txId: string): Wallet | null => {
      if (!id) return null;
      const w = walletsById.get(id);
      if (!w) {
        report.needsReview.push({
          transactionId: txId,
          reason: `references missing wallet ${id}`,
        });
        return null;
      }
      return w;
    };

    for (const tx of transactions) {
      if (tx.type === TransactionType.VIRTUAL) continue; // never real money
      if (isChildLeg(tx.idempotencyKey)) continue; // folded into its parent below

      const alreadyPosted = await journalEntriesRepo.findOne({
        where: { transactionId: tx.id },
      });
      if (alreadyPosted) {
        report.skippedAlreadyPosted++;
        continue;
      }

      try {
        await dataSource.transaction(async (manager) => {
          const posted = await postForTransaction(tx, {
            manager,
            ledger,
            walletsById,
            wallet,
            byIdempotencyKey,
            reversalMarkersByOriginalId,
            railSettlementsRepo,
          });
          if (posted) {
            report.posted[tx.type] = (report.posted[tx.type] ?? 0) + 1;
          } else {
            report.skippedNoMoneyMoved++;
          }
          if (DRY_RUN) {
            // Roll back — this transaction only exists so postEntry's own
            // validation (balanced legs, seeded accounts) runs for real.
            throw new DryRunRollback();
          }
        });
      } catch (error) {
        if (error instanceof DryRunRollback) continue;
        report.needsReview.push({
          transactionId: tx.id,
          reason: (error as Error).message,
        });
      }
    }
  } finally {
    await dataSource.destroy();
  }

  console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Backfill complete.`);
  console.log('Posted:', report.posted);
  console.log('Already had a journal entry (skipped):', report.skippedAlreadyPosted);
  console.log('No money ever moved (skipped):', report.skippedNoMoneyMoved);
  if (report.needsReview.length) {
    console.log(`\n${report.needsReview.length} row(s) need manual review:`);
    for (const item of report.needsReview) {
      console.log(`  - ${item.transactionId}: ${item.reason}`);
    }
    process.exitCode = 1;
  }
}

class DryRunRollback extends Error {}

interface Ctx {
  manager: EntityManager;
  ledger: LedgerService;
  walletsById: Map<string, Wallet>;
  wallet: (id: string | null, txId: string) => Wallet | null;
  byIdempotencyKey: Map<string, Transaction>;
  reversalMarkersByOriginalId: Map<string, Transaction>;
  railSettlementsRepo: import('typeorm').Repository<RailSettlement>;
}

// Returns false when the row genuinely never moved money (nothing to post),
// true once a journal entry was posted.
async function postForTransaction(tx: Transaction, ctx: Ctx): Promise<boolean> {
  switch (tx.type) {
    case TransactionType.DEPOSIT:
      return postDeposit(tx, ctx);
    case TransactionType.WITHDRAW:
      return postWithdraw(tx, ctx);
    case TransactionType.TRANSFER:
      return postTransfer(tx, ctx);
    case TransactionType.ADJUSTMENT:
      return postAdjustment(tx, ctx);
    case TransactionType.PURCHASE:
      return postPurchase(tx, ctx);
    default:
      return false;
  }
}

async function postDeposit(tx: Transaction, ctx: Ctx): Promise<boolean> {
  if (tx.status !== TransactionStatus.COMPLETED) return false;
  const { manager, ledger, walletsById, wallet, byIdempotencyKey } = ctx;

  if (tx.completesPurchaseId) {
    const supportWallet = wallet(tx.toWalletId, tx.id);
    if (!supportWallet) return false;
    await ledger.postCashMovement(
      manager,
      tx.id,
      'Credit shortfall top-up (backfill)',
      ledgerWalletLeg(supportWallet, walletsById),
      BigInt(tx.amount),
      GlAccountCode.BANK_CASH,
    );
    return true;
  }

  if (tx.installmentId || tx.settlesWalletId) {
    const mainRepository = wallet(tx.toWalletId, tx.id);
    if (!mainRepository) return false;
    const legs = [
      { wallet: ownWalletLeg(mainRepository), amount: BigInt(tx.amount) },
    ];
    for (const suffix of ['fee', 'penalty', 'unblock-fee']) {
      const sibling = byIdempotencyKey.get(`repayment-split:${tx.id}-${suffix}`);
      if (!sibling) continue;
      const subRepository = wallet(sibling.toWalletId, sibling.id);
      if (!subRepository) continue;
      legs.push({
        wallet: ownWalletLeg(subRepository),
        amount: BigInt(sibling.amount),
      });
    }
    const total = legs.reduce((sum, l) => sum + l.amount, 0n);
    await ledger.postCashInMultiLeg(
      manager,
      tx.id,
      'Installment repayment (backfill)',
      GlAccountCode.BANK_CASH,
      mainRepository.walletType.currencyId,
      total,
      legs,
    );
    return true;
  }

  const toWallet = wallet(tx.toWalletId, tx.id);
  if (!toWallet) return false;
  await ledger.postCashMovement(
    manager,
    tx.id,
    'Deposit (backfill)',
    ledgerWalletLeg(toWallet, walletsById),
    BigInt(tx.amount),
    GlAccountCode.BANK_CASH,
  );
  return true;
}

async function postWithdraw(tx: Transaction, ctx: Ctx): Promise<boolean> {
  const { manager, ledger, walletsById, wallet, railSettlementsRepo } = ctx;
  const fromWallet = wallet(tx.fromWalletId, tx.id);
  if (!fromWallet) return false;

  let cashAccount: GlAccountCode.BANK_CASH | GlAccountCode.SETTLEMENT_CLEARING =
    GlAccountCode.BANK_CASH;
  if (tx.railSettlementId) {
    const settlement = await railSettlementsRepo.findOne({
      where: { id: tx.railSettlementId },
    });
    if (settlement && settlement.status !== RailSettlementStatus.COMPLETED) {
      cashAccount = GlAccountCode.SETTLEMENT_CLEARING;
    }
  }

  await ledger.postCashMovement(
    manager,
    tx.id,
    'Withdraw (backfill)',
    ledgerWalletLeg(fromWallet, walletsById),
    -BigInt(tx.amount),
    cashAccount,
  );
  if (fromWallet.repositoryWalletId) {
    await ledger.postRepositoryAllocationMirror(
      manager,
      tx.id,
      'Withdraw (backfill)',
      ownWalletLeg(fromWallet),
      -BigInt(tx.amount),
    );
  }
  return true;
}

async function postTransfer(tx: Transaction, ctx: Ctx): Promise<boolean> {
  const { manager, ledger, walletsById, wallet } = ctx;
  const fromWallet = wallet(tx.fromWalletId, tx.id);
  const toWallet = wallet(tx.toWalletId, tx.id);
  if (!fromWallet || !toWallet) return false;

  await ledger.postWalletToWallet(
    manager,
    tx.id,
    'Transfer (backfill)',
    ledgerWalletLeg(fromWallet, walletsById),
    ownWalletLeg(toWallet),
    BigInt(tx.amount),
  );
  if (fromWallet.repositoryWalletId) {
    await ledger.postRepositoryAllocationMirror(
      manager,
      tx.id,
      'Transfer (backfill)',
      ownWalletLeg(fromWallet),
      -BigInt(tx.amount),
    );
  }
  return true;
}

async function postAdjustment(tx: Transaction, ctx: Ctx): Promise<boolean> {
  const { manager, ledger, wallet, byIdempotencyKey } = ctx;

  const creditLegs: Array<{ wallet: WalletLegInput; amount: bigint }> = [];
  for (const prefix of ['overdue-absorb', 'quit-absorb']) {
    for (const suffix of ['fee', 'penalty', 'unblock-fee']) {
      const sibling = byIdempotencyKey.get(
        `${prefix}:${tx.idempotencyKey}-${suffix}`,
      );
      if (!sibling) continue;
      const subRepository = wallet(sibling.toWalletId, sibling.id);
      if (!subRepository) continue;
      creditLegs.push({
        wallet: ownWalletLeg(subRepository),
        amount: BigInt(sibling.amount),
      });
    }
  }

  if (creditLegs.length > 0) {
    const repository = wallet(tx.fromWalletId, tx.id);
    if (!repository) return false;
    const routedTotal = creditLegs.reduce((sum, l) => sum + l.amount, 0n);
    await ledger.postMultiLeg(
      manager,
      tx.id,
      'Overdue/offboarding debt absorbed by repository (backfill)',
      [{ wallet: ownWalletLeg(repository), amount: routedTotal }],
      creditLegs,
    );
    return true;
  }

  // A plain admin correction — never routed anywhere, so it isn't one of
  // the overdue/quit absorption rows above.
  const targetWalletId = tx.toWalletId ?? tx.fromWalletId;
  const target = wallet(targetWalletId, tx.id);
  if (!target) return false;
  const delta = tx.toWalletId ? BigInt(tx.amount) : -BigInt(tx.amount);
  await ledger.postAdjustment(
    manager,
    tx.id,
    tx.note ?? 'Adjustment (backfill)',
    ownWalletLeg(target),
    delta,
  );
  return true;
}

async function postPurchase(tx: Transaction, ctx: Ctx): Promise<boolean> {
  const {
    manager,
    ledger,
    walletsById,
    wallet,
    byIdempotencyKey,
    reversalMarkersByOriginalId,
  } = ctx;

  if (tx.status === TransactionStatus.REVERSED && tx.relatedTransactionId) {
    // This row IS the reversal marker (see reverseTransaction) — post the
    // refund, mirroring the original's funding split back out.
    const merchantWallet = wallet(tx.fromWalletId, tx.id);
    const customerWallet = wallet(tx.toWalletId, tx.id);
    if (!merchantWallet || !customerWallet) return false;

    const repositoryLeg = byIdempotencyKey.get(
      `credit-fund-reverse:${tx.relatedTransactionId}`,
    );
    const repositoryAmount = repositoryLeg ? BigInt(repositoryLeg.amount) : 0n;
    const customerCreditAmount = BigInt(tx.amount) - repositoryAmount;

    const creditLegs: Array<{ wallet: WalletLegInput; amount: bigint }> = [];
    if (customerCreditAmount > 0n) {
      creditLegs.push({
        wallet: ownWalletLeg(customerWallet),
        amount: customerCreditAmount,
      });
    }
    if (repositoryLeg && repositoryAmount > 0n) {
      const repository = wallet(repositoryLeg.toWalletId, repositoryLeg.id);
      if (repository) {
        creditLegs.push({
          wallet: ownWalletLeg(repository),
          amount: repositoryAmount,
        });
      }
    }
    if (creditLegs.length === 0) return false;

    await ledger.postReversal(
      manager,
      tx.relatedTransactionId,
      tx.id,
      tx.note ?? 'Refund (backfill)',
      [{ wallet: ownWalletLeg(merchantWallet), amount: BigInt(tx.amount) }],
      creditLegs,
    );
    return true;
  }

  const wasCompleted =
    tx.status === TransactionStatus.COMPLETED ||
    (tx.status === TransactionStatus.REVERSED &&
      reversalMarkersByOriginalId.has(tx.id));
  if (!wasCompleted) return false; // timed out or cancelled before ever completing

  const fromWallet = wallet(tx.fromWalletId, tx.id);
  const toWallet = wallet(tx.toWalletId, tx.id);
  if (!fromWallet || !toWallet) return false;

  const debitLegs: Array<{ wallet: WalletLegInput; amount: bigint }> = [];
  const supportLeg = byIdempotencyKey.get(`support-fund:${tx.id}`);
  if (supportLeg) {
    const supportWallet = wallet(supportLeg.fromWalletId, supportLeg.id);
    if (supportWallet) {
      debitLegs.push({
        wallet: ownWalletLeg(supportWallet),
        amount: BigInt(supportLeg.amount),
      });
    }
  }
  const creditFundLeg = byIdempotencyKey.get(`credit-fund:${tx.id}`);
  if (creditFundLeg) {
    const repository = wallet(creditFundLeg.fromWalletId, creditFundLeg.id);
    if (repository) {
      debitLegs.push({
        wallet: ownWalletLeg(repository),
        amount: BigInt(creditFundLeg.amount),
      });
    }
  }
  if (debitLegs.length === 0) {
    debitLegs.push({
      wallet: ledgerWalletLeg(fromWallet, walletsById),
      amount: BigInt(tx.amount),
    });
  }

  await ledger.postMultiLeg(
    manager,
    tx.id,
    'Purchase (backfill)',
    debitLegs,
    [{ wallet: ownWalletLeg(toWallet), amount: BigInt(tx.amount) }],
  );
  return true;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
