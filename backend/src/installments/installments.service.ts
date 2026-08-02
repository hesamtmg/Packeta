import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Installment, InstallmentStatus } from './entities/installment.entity';
import { Wallet } from '../wallets/entities/wallet.entity';

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
  ) {}

  // Splits a granted virtualAmount into installmentCount equal shares — the
  // remainder, if any, folds into the last installment so the total always
  // reconciles exactly. This is the fee/penalty percentage base
  // (Installment.principalAmount), fixed at generation time.
  computeInstallmentPrincipal(
    virtualAmount: bigint,
    installmentCount: number,
    sequenceNumber: number,
  ): bigint {
    const share = virtualAmount / BigInt(installmentCount);
    const remainder = virtualAmount % BigInt(installmentCount);
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

  // Generates the next scheduled installment for every repository-backed
  // credit wallet whose type's installmentDate matches today, and that
  // hasn't yet had all installmentCount installments generated. Idempotent
  // within a single day — skips a wallet that already has an installment
  // dated today.
  async generateDue(today: Date = new Date()): Promise<Installment[]> {
    const dayOfMonth = today.getDate();
    const todayDate = toDateOnly(today);

    const wallets = await this.walletsRepository
      .createQueryBuilder('wallet')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .where('wallet.repositoryWalletId IS NOT NULL')
      .andWhere('wallet.closedAt IS NULL')
      .andWhere('walletType.installmentDate = :dayOfMonth', { dayOfMonth })
      .andWhere('walletType.installmentCount IS NOT NULL')
      .andWhere('wallet.virtualAmount IS NOT NULL')
      .getMany();

    const created: Installment[] = [];
    for (const wallet of wallets) {
      const installmentCount = wallet.walletType.installmentCount!;
      const existing = await this.installmentsRepository.find({
        where: { walletId: wallet.id },
      });
      if (existing.length >= installmentCount) continue;
      if (existing.some((i) => i.dueDate === todayDate)) continue;

      const sequenceNumber = existing.length + 1;
      const principal = this.computeInstallmentPrincipal(
        BigInt(wallet.virtualAmount!),
        installmentCount,
        sequenceNumber,
      );
      const fee = this.percentOf(principal, wallet.walletType.feePercent);
      const amount = principal + fee;
      const deadlineDate = wallet.walletType.paymentDeadlineDate
        ? this.computeDeadlineDate(today, wallet.walletType.paymentDeadlineDate)
        : today;

      const installment = this.installmentsRepository.create({
        walletId: wallet.id,
        sequenceNumber,
        amount: amount.toString(),
        principalAmount: principal.toString(),
        dueDate: todayDate,
        deadlineDate: toDateOnly(deadlineDate),
        status: InstallmentStatus.PENDING,
      });
      created.push(await this.installmentsRepository.save(installment));
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
      }
    }
  }
}
