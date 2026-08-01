import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Installment, InstallmentStatus } from './entities/installment.entity';
import { Wallet } from '../wallets/entities/wallet.entity';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
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

  // Splits a granted virtualAmount into installmentCount equal shares (the
  // remainder, if any, folds into the last installment so the total always
  // reconciles exactly), plus the type's flat fee on every installment.
  computeInstallmentAmount(
    virtualAmount: bigint,
    installmentCount: number,
    sequenceNumber: number,
    fee: bigint,
  ): bigint {
    const share = virtualAmount / BigInt(installmentCount);
    const remainder = virtualAmount % BigInt(installmentCount);
    const isLast = sequenceNumber === installmentCount;
    return share + (isLast ? remainder : 0n) + fee;
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
      const fee = wallet.walletType.fee ? BigInt(wallet.walletType.fee) : 0n;
      const amount = this.computeInstallmentAmount(
        BigInt(wallet.virtualAmount!),
        installmentCount,
        sequenceNumber,
        fee,
      );
      const deadlineDate = wallet.walletType.paymentDeadlineDate
        ? this.computeDeadlineDate(today, wallet.walletType.paymentDeadlineDate)
        : today;

      const installment = this.installmentsRepository.create({
        walletId: wallet.id,
        sequenceNumber,
        amount: amount.toString(),
        dueDate: todayDate,
        deadlineDate: toDateOnly(deadlineDate),
        status: InstallmentStatus.PENDING,
      });
      created.push(await this.installmentsRepository.save(installment));
    }
    return created;
  }

  // Every still-PENDING installment past its deadline: adds the type's flat
  // penalty, marks it OVERDUE, and blocks its wallet from further outgoing
  // money movement until repaid.
  async applyOverduePenalties(today: Date = new Date()): Promise<number> {
    const todayDate = toDateOnly(today);
    const overdue = await this.installmentsRepository
      .createQueryBuilder('installment')
      .innerJoinAndSelect('installment.wallet', 'wallet')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .where('installment.status = :status', {
        status: InstallmentStatus.PENDING,
      })
      .andWhere('installment.deadlineDate < :todayDate', { todayDate })
      .getMany();

    for (const installment of overdue) {
      const penalty = installment.wallet.walletType.penalty
        ? BigInt(installment.wallet.walletType.penalty)
        : 0n;
      installment.amount = (BigInt(installment.amount) + penalty).toString();
      installment.penaltyApplied = true;
      installment.status = InstallmentStatus.OVERDUE;
      await this.installmentsRepository.save(installment);

      if (!installment.wallet.blockedAt) {
        await this.walletsRepository.update(installment.wallet.id, {
          blockedAt: new Date(),
        });
      }
    }
    return overdue.length;
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
  // the repayment purchase completes: marks the installment PAID and, if its
  // wallet was blocked, clears the block.
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
    }
  }
}
