import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Installment, InstallmentStatus } from './entities/installment.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import { WalletType } from '../wallet-types/entities/wallet-type.entity';
import { UsersService } from '../users/users.service';
import { displayIdentity } from '../common/synthetic-email';
import { LoggingService } from '../logging/logging.service';
import { LedgerService } from '../gl/ledger.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// One purchase's worth of a billing period's spend, resolved back from a
// VIRTUAL credit-ceiling draw-down (see TransactionsService
// .settleCreditFundedPurchase's relatedPurchaseId) to the merchant it paid
// — what InstallmentsService.getSpendBreakdown returns, so the customer can
// see where the money in a given installment actually went.
export interface SpendDetail {
  purchaseId: string;
  merchantName: string;
  amount: string;
  spentAt: Date;
}

// One row of a purchase's repayment plan, before (or independent of) being
// saved — see InstallmentsService.buildSchedule.
export interface ScheduledInstallment {
  sequenceNumber: number;
  principalAmount: string;
  feeAmount: string;
  amount: string;
  dueDate: string;
  deadlineDate: string;
}

// One row of the admin overdue-collection queue — see
// findBlockedWalletsSummary/findBlockedWalletsSummaryForWallets.
export interface BlockedWalletSummary {
  walletId: string;
  ownerEmail: string;
  ownerPhoneNumber: string | null;
  walletTypeName: string;
  currency: { code: string; symbol: string };
  blockedAt: Date;
  totalOwed: string;
  repositoryWalletId: string | null;
}

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
    private readonly usersService: UsersService,
    private readonly loggingService: LoggingService,
    private readonly ledgerService: LedgerService,
  ) {}

  // Splits a purchase's credit-drawn amount (see buildSchedule) into installmentCount
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

  // Recovers the principal/fee/penalty breakdown of one or more
  // installments' combined `amount` from their own fixed-at-generation
  // principalAmount and feeAmount — penalty is whatever's left over
  // (amount - principalAmount - feeAmount), since it's the only one of the
  // three that keeps growing after generation (see applyOverduePenalties).
  // Used by TransactionsService to route a repayment's fee/penalty slices to
  // their own dedicated repositories instead of the credit wallet's main
  // backing repository — see WalletType.feeRepositoryWalletId etc.
  computeRepaymentSplit(installments: Installment[]): {
    principal: bigint;
    fee: bigint;
    penalty: bigint;
  } {
    let principal = 0n;
    let fee = 0n;
    let total = 0n;
    for (const installment of installments) {
      principal += BigInt(installment.principalAmount);
      fee += BigInt(installment.feeAmount);
      total += BigInt(installment.amount);
    }
    return { principal, fee, penalty: total - principal - fee };
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

  // The repayment schedule one credit-funded purchase of `amount` turns
  // into, without persisting anything — shared by createForPurchase (which
  // saves it) and previewSchedule (shown to the customer on the pay page
  // before they confirm). `amount` is split into installmentCount equal
  // principal shares (remainder folded into the last), each with the
  // type's feePercent on top. Installment 1 falls due on the next
  // installmentDate day-of-month after the purchase (or one month after the
  // purchase, if the type sets no installmentDate), and each later one a
  // month after the previous. Returns [] when the type has no
  // installmentCount (not an installment-based credit line).
  buildSchedule(
    amount: bigint,
    walletType: Pick<
      WalletType,
      | 'installmentCount'
      | 'installmentDate'
      | 'paymentDeadlineDate'
      | 'feePercent'
    >,
    purchasedAt: Date,
  ): ScheduledInstallment[] {
    const installmentCount = walletType.installmentCount;
    if (!installmentCount || installmentCount < 1 || amount <= 0n) return [];

    const purchaseDay = new Date(
      purchasedAt.getFullYear(),
      purchasedAt.getMonth(),
      purchasedAt.getDate(),
    );
    const anchorDay = walletType.installmentDate ?? purchaseDay.getDate();
    let firstMonthOffset = 1;
    if (walletType.installmentDate) {
      const sameMonth = dateForDayOfMonth(
        purchaseDay.getFullYear(),
        purchaseDay.getMonth(),
        anchorDay,
      );
      firstMonthOffset = sameMonth.getTime() > purchaseDay.getTime() ? 0 : 1;
    }

    const schedule: ScheduledInstallment[] = [];
    for (
      let sequenceNumber = 1;
      sequenceNumber <= installmentCount;
      sequenceNumber++
    ) {
      const principal = this.computeInstallmentPrincipal(
        amount,
        installmentCount,
        sequenceNumber,
      );
      const fee = this.percentOf(principal, walletType.feePercent);
      const dueDate = dateForDayOfMonth(
        purchaseDay.getFullYear(),
        purchaseDay.getMonth() + firstMonthOffset + (sequenceNumber - 1),
        anchorDay,
      );
      const deadlineDate = walletType.paymentDeadlineDate
        ? this.computeDeadlineDate(dueDate, walletType.paymentDeadlineDate)
        : dueDate;
      schedule.push({
        sequenceNumber,
        principalAmount: principal.toString(),
        feeAmount: fee.toString(),
        amount: (principal + fee).toString(),
        dueDate: toDateOnly(dueDate),
        deadlineDate: toDateOnly(deadlineDate),
      });
    }
    return schedule;
  }

  // Called from inside TransactionsService.settleCreditFundedPurchase's DB
  // transaction the moment a credit-funded purchase completes: turns the
  // slice of it that was drawn on the credit line (`drawnAmount` — not any
  // part already paid in real money via a support top-up) into its own
  // installment plan, so the customer can see what they owe for that
  // purchase straight away. Idempotent per purchase — a repeat call finds
  // the plan already on record and returns it unchanged.
  async createForPurchase(
    manager: EntityManager,
    wallet: Pick<Wallet, 'id'> & { walletType: WalletType },
    purchase: Pick<Transaction, 'id'>,
    drawnAmount: bigint,
    purchasedAt: Date = new Date(),
  ): Promise<Installment[]> {
    const existing = await manager.find(Installment, {
      where: { purchaseTransactionId: purchase.id },
      order: { sequenceNumber: 'ASC' },
    });
    if (existing.length) return existing;

    const schedule = this.buildSchedule(
      drawnAmount,
      wallet.walletType,
      purchasedAt,
    );
    const purchaseDate = toDateOnly(
      new Date(
        purchasedAt.getFullYear(),
        purchasedAt.getMonth(),
        purchasedAt.getDate(),
      ),
    );
    const created: Installment[] = [];
    for (const row of schedule) {
      const installment = manager.create(Installment, {
        walletId: wallet.id,
        purchaseTransactionId: purchase.id,
        periodStart: purchaseDate,
        periodEnd: purchaseDate,
        sequenceNumber: row.sequenceNumber,
        amount: row.amount,
        principalAmount: row.principalAmount,
        feeAmount: row.feeAmount,
        dueDate: row.dueDate,
        deadlineDate: row.deadlineDate,
        status: InstallmentStatus.PENDING,
      });
      created.push(await manager.save(installment));
    }
    return created;
  }

  // The installment plan a given purchase produced, in order.
  async findForPurchase(purchaseTransactionId: string): Promise<Installment[]> {
    return this.installmentsRepository.find({
      where: { purchaseTransactionId },
      order: { sequenceNumber: 'ASC' },
    });
  }

  // Called from inside TransactionsService.reverseTransaction when a
  // credit-funded purchase is refunded: every still-unpaid installment of
  // its plan is CANCELED — the refund already returned the drawn amount to
  // the repository and restored the ceiling, so nothing is owed any more.
  // Returns how many rows were canceled.
  async cancelForPurchase(
    manager: EntityManager,
    purchaseTransactionId: string,
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder()
      .update(Installment)
      .set({ status: InstallmentStatus.CANCELED })
      .where('purchaseTransactionId = :purchaseTransactionId', {
        purchaseTransactionId,
      })
      .andWhere('status IN (:...statuses)', {
        statuses: [InstallmentStatus.PENDING, InstallmentStatus.OVERDUE],
      })
      .execute();
    return result.affected ?? 0;
  }

  // The daily due-date check: every still-PENDING installment whose dueDate
  // has arrived and that hasn't been checked yet is looked at again. If the
  // purchase it came from has since been reversed, the installment is
  // CANCELED (nothing is owed); otherwise it's stamped dueCheckedAt and
  // reported back as due today, so the scheduler can log/notify it. Safe to
  // run any number of times a day — each installment is checked once.
  async checkDueInstallments(
    today: Date = new Date(),
  ): Promise<{ due: Installment[]; canceled: Installment[] }> {
    const todayDate = toDateOnly(today);
    const candidates = await this.installmentsRepository
      .createQueryBuilder('installment')
      .where('installment.status = :status', {
        status: InstallmentStatus.PENDING,
      })
      .andWhere('installment.dueDate <= :todayDate', { todayDate })
      .andWhere('installment.dueCheckedAt IS NULL')
      .getMany();

    const due: Installment[] = [];
    const canceled: Installment[] = [];
    const purchaseStatus = new Map<string, TransactionStatus | null>();
    for (const installment of candidates) {
      let status: TransactionStatus | null = TransactionStatus.COMPLETED;
      if (installment.purchaseTransactionId) {
        const id = installment.purchaseTransactionId;
        if (!purchaseStatus.has(id)) {
          const purchase = await this.transactionsRepository.findOne({
            where: { id },
          });
          purchaseStatus.set(id, purchase?.status ?? null);
        }
        status = purchaseStatus.get(id)!;
      }

      installment.dueCheckedAt = new Date();
      if (status === TransactionStatus.REVERSED) {
        installment.status = InstallmentStatus.CANCELED;
        canceled.push(await this.installmentsRepository.save(installment));
      } else {
        due.push(await this.installmentsRepository.save(installment));
      }
    }
    return { due, canceled };
  }

  // Every still-unpaid installment past its deadline (PENDING transitioning
  // to OVERDUE, or already OVERDUE and still accruing): tops up `amount` by
  // penaltyPercentPerDay x principalAmount for each day elapsed since the
  // last time this ran that hasn't already been charged (penaltyDaysApplied
  // tracks that), and marks it OVERDUE. Safe to run more or less than once a
  // day — it always converges to "penaltyDaysApplied days worth of
  // penalty", never double-charging a day twice.
  //
  // Missing the deadline alone does NOT block the wallet anymore — only
  // once the MOST overdue unpaid installment's daysOverdue exceeds the
  // type's overdueDaysBeforeBlock (see WalletType) does the wallet actually
  // get frozen, with an admin-facing log entry (surfaced in the admin
  // panel's scheduler-log view) noting who crossed the line and by how
  // much, so an admin can go collect via one of the three overdue-collection
  // methods (see TransactionsService). A type with overdueDaysBeforeBlock
  // left unset never auto-blocks — penalty still accrues, that's all.
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
    const maxDaysOverdueByWallet = new Map<string, number>();
    for (const installment of unpaid) {
      const daysOverdue = daysBetween(installment.deadlineDate, todayDate);
      const owedDays = daysOverdue - installment.penaltyDaysApplied;
      const alreadyOverdue = installment.status === InstallmentStatus.OVERDUE;
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
        installment.penaltyApplied = true;
        installment.status = InstallmentStatus.OVERDUE;
        await this.installmentsRepository.save(installment);
        affected++;
      } else if (!alreadyOverdue) {
        installment.penaltyApplied = true;
        installment.status = InstallmentStatus.OVERDUE;
        await this.installmentsRepository.save(installment);
        affected++;
      }

      const walletId = installment.wallet.id;
      maxDaysOverdueByWallet.set(
        walletId,
        Math.max(maxDaysOverdueByWallet.get(walletId) ?? 0, daysOverdue),
      );
    }

    const walletsById = new Map(unpaid.map((i) => [i.wallet.id, i.wallet]));
    for (const [walletId, maxDaysOverdue] of maxDaysOverdueByWallet) {
      const wallet = walletsById.get(walletId)!;
      const threshold = wallet.walletType.overdueDaysBeforeBlock;
      if (
        wallet.blockedAt ||
        threshold == null ||
        maxDaysOverdue <= threshold
      ) {
        continue;
      }

      await this.walletsRepository.update(walletId, {
        blockedAt: new Date(),
      });
      const totalOwed = unpaid
        .filter((i) => i.wallet.id === walletId)
        .reduce((sum, i) => sum + BigInt(i.amount), 0n);
      await this.loggingService.log({
        category: 'SCHEDULER',
        action: 'installment_overdue_block',
        success: true,
        userId: wallet.userId,
        metadata: {
          walletId,
          daysOverdue: maxDaysOverdue,
          overdueDaysBeforeBlock: threshold,
          totalOwed: totalOwed.toString(),
        },
      });
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

  // Admin-only, scoped: same shape as findAll but restricted to installments
  // on the given wallet ids — the regular-ADMIN counterpart, used to
  // restrict the panel's Installments view to an admin's own wallet graph
  // (see WalletsService.listScopedWalletIdsForAdmin).
  async findAllForWallets(walletIds: string[]): Promise<Installment[]> {
    if (!walletIds.length) {
      return [];
    }
    return this.installmentsRepository
      .createQueryBuilder('installment')
      .innerJoinAndSelect('installment.wallet', 'wallet')
      .innerJoinAndSelect('wallet.user', 'user')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .innerJoinAndSelect('walletType.currency', 'currency')
      .where('installment.walletId IN (:...walletIds)', { walletIds })
      .orderBy('installment.deadlineDate', 'DESC')
      .getMany();
  }

  // The credit wallet an installment belongs to, or null if the id is
  // unknown — no ownership check (callers do their own).
  async findWalletIdForInstallment(
    installmentId: string,
  ): Promise<string | null> {
    const installment = await this.installmentsRepository.findOne({
      where: { id: installmentId },
      select: { id: true, walletId: true },
    });
    return installment?.walletId ?? null;
  }

  // Every installment id on the given credit wallets — used to surface
  // installment repayments (which land on the lender's repository wallet,
  // not the customer's) in the customer's own transaction history.
  // Returns installment id -> credit wallet id.
  async findWalletIdsByInstallment(
    walletIds: string[],
  ): Promise<Map<string, string>> {
    if (!walletIds.length) return new Map();
    const rows = await this.installmentsRepository.find({
      where: { walletId: In(walletIds) },
      select: { id: true, walletId: true },
    });
    return new Map(rows.map((r) => [r.id, r.walletId]));
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

  // Every purchase the customer's own draw-downs paid for within a billing
  // period (see generateDue) — the merchant-spend detail behind a period's
  // summed total. Mirrors generateDue's own window exactly: draw-downs are
  // always fromWalletId = this wallet (money leaving its ceiling), so only
  // that side is queried here, unlike generateDue's sum which also counts
  // the grant and restores landing on the wallet.
  private async getSpendBreakdown(
    walletId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<SpendDetail[]> {
    const drawDowns = await this.transactionsRepository
      .createQueryBuilder('t')
      .where('t.type = :type', { type: TransactionType.VIRTUAL })
      .andWhere('t.fromWalletId = :walletId', { walletId })
      .andWhere('t.createdAt >= :periodStart', {
        periodStart: new Date(periodStart),
      })
      .andWhere('t.createdAt < :periodEnd', {
        periodEnd: new Date(periodEnd),
      })
      .orderBy('t.createdAt', 'ASC')
      .getMany();

    const details: SpendDetail[] = [];
    for (const drawDown of drawDowns) {
      if (!drawDown.relatedPurchaseId) continue;
      const detail = await this.describePurchase(drawDown.relatedPurchaseId);
      if (!detail) continue;
      details.push({
        ...detail,
        amount: drawDown.amount,
        spentAt: drawDown.createdAt,
      });
    }
    return details;
  }

  // Resolves one purchase to the merchant it paid, for the spend detail
  // shown beside an installment.
  private async describePurchase(
    purchaseId: string,
  ): Promise<SpendDetail | null> {
    const purchase = await this.transactionsRepository.findOne({
      where: { id: purchaseId },
    });
    if (!purchase?.toWalletId) return null;
    const merchantWallet = await this.walletsRepository.findOne({
      where: { id: purchase.toWalletId },
    });
    if (!merchantWallet) return null;
    const merchantUser = await this.usersService.findById(
      merchantWallet.userId,
    );
    return {
      purchaseId: purchase.id,
      merchantName:
        merchantWallet.storeName ||
        (merchantUser ? displayIdentity(merchantUser) : 'Merchant'),
      amount: purchase.amount,
      spentAt: purchase.createdAt,
    };
  }

  // Batched version of getSpendBreakdown for a whole list of installments
  // (see InstallmentsController): every installment sharing the same
  // (walletId, periodStart, periodEnd) batch was split from the same
  // period total, so its spend breakdown is computed once and shared
  // across all of that batch's rows rather than re-queried per row.
  async getSpendBreakdownsFor(
    installments: Installment[],
  ): Promise<Map<string, SpendDetail[]>> {
    const periods = new Map<
      string,
      {
        walletId: string;
        periodStart: string;
        periodEnd: string;
        installmentIds: string[];
      }
    >();
    const byPurchase = new Map<string, string[]>();
    for (const installment of installments) {
      // Per-purchase plans resolve straight to the one purchase they repay.
      if (installment.purchaseTransactionId) {
        const ids = byPurchase.get(installment.purchaseTransactionId);
        if (ids) ids.push(installment.id);
        else
          byPurchase.set(installment.purchaseTransactionId, [installment.id]);
        continue;
      }
      const key = `${installment.walletId}:${installment.periodStart}:${installment.periodEnd}`;
      const entry = periods.get(key);
      if (entry) {
        entry.installmentIds.push(installment.id);
      } else {
        periods.set(key, {
          walletId: installment.walletId,
          periodStart: installment.periodStart,
          periodEnd: installment.periodEnd,
          installmentIds: [installment.id],
        });
      }
    }

    const result = new Map<string, SpendDetail[]>();
    for (const [purchaseId, installmentIds] of byPurchase) {
      const detail = await this.describePurchase(purchaseId);
      for (const id of installmentIds) {
        result.set(id, detail ? [detail] : []);
      }
    }
    for (const {
      walletId,
      periodStart,
      periodEnd,
      installmentIds,
    } of periods.values()) {
      const details = await this.getSpendBreakdown(
        walletId,
        periodStart,
        periodEnd,
      );
      for (const id of installmentIds) {
        result.set(id, details);
      }
    }
    return result;
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
    const installment = await manager.findOne(Installment, {
      where: { id: installmentId },
    });
    if (!installment) return;
    await this.settleOneInstallment(manager, installment, transactionId);
    await manager.update(Wallet, installment.walletId, { blockedAt: null });
  }

  // Marks every still-unpaid (PENDING or OVERDUE) installment on a credit
  // wallet PAID in one go and clears its block — used by the three
  // admin-triggered overdue-collection methods on TransactionsService
  // (ZarinPal, repository-absorbed, and manual+document), each of which
  // settles the wallet's ENTIRE outstanding balance at once rather than one
  // installment at a time like the customer's own payInstallment/markPaid.
  async markAllPaidAndUnblock(
    manager: EntityManager,
    walletId: string,
    transactionId: string,
  ): Promise<void> {
    const installments = await manager
      .createQueryBuilder(Installment, 'installment')
      .setLock('pessimistic_write')
      .where('installment.walletId = :walletId', { walletId })
      .andWhere('installment.status IN (:...statuses)', {
        statuses: [InstallmentStatus.PENDING, InstallmentStatus.OVERDUE],
      })
      .getMany();
    for (const installment of installments) {
      await this.settleOneInstallment(manager, installment, transactionId);
    }
    await manager.update(Wallet, walletId, { blockedAt: null });
  }

  // Shared by markPaid (one installment) and markAllPaidAndUnblock (every
  // outstanding installment on a wallet): marks the row PAID and restores
  // the wallet's virtualAmount ceiling by its PRINCIPAL share only — the
  // mirror image of the draw-down recorded at spend time (see
  // TransactionsService.settleCreditFundedPurchase, which only ever draws
  // the ceiling down by the actual purchase amount). Fee/penalty/unblockFee
  // were never part of that draw-down — they're charges added on top at
  // installment-generation/overdue time — so restoring the full
  // installment.amount here would inflate the ceiling past what it
  // originally was. Re-reads the wallet's current virtualAmount on every
  // call rather than caching it, so looping this across several
  // installments in the same DB transaction still accumulates correctly.
  private async settleOneInstallment(
    manager: EntityManager,
    installment: Installment,
    transactionId: string,
  ): Promise<void> {
    await manager.update(Installment, installment.id, {
      status: InstallmentStatus.PAID,
      paidAt: new Date(),
      paymentTransactionId: transactionId,
    });
    const wallet = await manager.findOne(Wallet, {
      where: { id: installment.walletId },
      relations: { walletType: true },
    });
    if (!wallet) return;
    // The same principal that was drawn on the credit line comes off the
    // receivable — whether it was repaid or the repository absorbed it.
    await this.ledgerService.postCreditReceivable(
      manager,
      transactionId,
      'Installment principal settled',
      { id: wallet.id, walletType: wallet.walletType },
      -BigInt(installment.principalAmount),
    );
    const restored =
      BigInt(wallet.virtualAmount ?? '0') + BigInt(installment.principalAmount);
    await manager.update(Wallet, wallet.id, {
      virtualAmount: restored.toString(),
    });
    const restoreTransaction = manager.create(Transaction, {
      type: TransactionType.VIRTUAL,
      fromWalletId: null,
      toWalletId: wallet.id,
      amount: installment.principalAmount,
      idempotencyKey: `installment-restore:${installment.id}`,
      note: 'Credit wallet ceiling restored by installment repayment',
    });
    await manager.save(restoreTransaction);
  }

  // Every still-unpaid installment on a credit wallet, for the three
  // admin overdue-collection methods to compute how much is owed.
  async getOutstandingForWallet(walletId: string): Promise<Installment[]> {
    return this.installmentsRepository.find({
      where: {
        walletId,
        status: In([InstallmentStatus.PENDING, InstallmentStatus.OVERDUE]),
      },
    });
  }

  // Every currently-blocked credit wallet, for the admin overdue-collection
  // panel (see TransactionsService's three collection methods) — one row
  // per wallet with everything an admin needs to decide how to collect: who
  // owes it, how much (every outstanding installment's amount, folding in
  // unblockFee since any repayment while blocked owes that too — same rule
  // payInstallment already applies), and which repository backs it.
  async findBlockedWalletsSummary(): Promise<BlockedWalletSummary[]> {
    return this.blockedWalletsSummary();
  }

  // Admin-only, scoped: same as findBlockedWalletsSummary but restricted to
  // the given wallet ids — the regular-ADMIN counterpart, used to restrict
  // the panel's overdue-collection queue to an admin's own wallet graph.
  async findBlockedWalletsSummaryForWallets(
    walletIds: string[],
  ): Promise<BlockedWalletSummary[]> {
    if (!walletIds.length) {
      return [];
    }
    return this.blockedWalletsSummary(walletIds);
  }

  private async blockedWalletsSummary(
    walletIds?: string[],
  ): Promise<BlockedWalletSummary[]> {
    const query = this.walletsRepository
      .createQueryBuilder('wallet')
      .innerJoinAndSelect('wallet.user', 'user')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .innerJoinAndSelect('walletType.currency', 'currency')
      .where('wallet.blockedAt IS NOT NULL');
    if (walletIds) {
      query.andWhere('wallet.id IN (:...walletIds)', { walletIds });
    }
    const wallets = await query.getMany();

    const result: BlockedWalletSummary[] = [];
    for (const wallet of wallets) {
      const outstanding = await this.getOutstandingForWallet(wallet.id);
      if (!outstanding.length) continue;
      const totalOwed =
        outstanding.reduce((sum, i) => sum + BigInt(i.amount), 0n) +
        BigInt(wallet.walletType.unblockFee ?? '0');
      result.push({
        walletId: wallet.id,
        ownerEmail: wallet.user.email,
        ownerPhoneNumber: wallet.user.phoneNumber,
        walletTypeName: wallet.walletType.name,
        currency: wallet.walletType.currency,
        blockedAt: wallet.blockedAt!,
        totalOwed: totalOwed.toString(),
        repositoryWalletId: wallet.repositoryWalletId,
      });
    }
    return result;
  }
}
