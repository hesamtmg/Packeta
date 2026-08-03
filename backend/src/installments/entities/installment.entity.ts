import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Wallet } from '../../wallets/entities/wallet.entity';

export enum InstallmentStatus {
  PENDING = 'PENDING',
  OVERDUE = 'OVERDUE',
  PAID = 'PAID',
}

// One scheduled repayment of a credit wallet's virtualAmount activity over a
// billing period back to its repository — see InstallmentsService
// (generation from that period's VIRTUAL transactions + the overdue sweep)
// and TransactionsService.payInstallment (repayment, via the same IPG
// purchase flow as any other purchase, paid into the repository's real
// balance).
@Entity('installments')
export class Installment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  walletId: string;

  @ManyToOne(() => Wallet)
  @JoinColumn({ name: 'walletId' })
  wallet: Wallet;

  // The exact one-month billing window (see InstallmentsService.generateDue)
  // this installment's batch summed this wallet's own VIRTUAL transactions
  // over — [periodStart, periodEnd). Shared by every row generated in the
  // same batch (sequenceNumber 1..installmentCount); periodEnd is also how
  // generateDue tells a period already has its batch on record.
  @Column({ type: 'date' })
  periodStart: string;

  @Index()
  @Column({ type: 'date' })
  periodEnd: string;

  // 1-based position within the credit line's WalletType.installmentCount
  // schedule.
  @Column({ type: 'smallint' })
  sequenceNumber: number;

  // Principal share (virtualAmount / installmentCount, remainder folded into
  // the last installment) plus the type's feePercent, in minor units. Grows
  // by penaltyPercentPerDay for every day it stays unpaid past deadlineDate.
  @Column({ type: 'bigint' })
  amount: string;

  // The principal share alone, fixed at generation time before feePercent is
  // folded into `amount` — the fee/penalty percentage base, so daily penalty
  // accrual is always a percentage of this fixed principal rather than of
  // the ever-growing `amount` (which would compound).
  @Column({ type: 'bigint' })
  principalAmount: string;

  // The fee share alone (feePercent of principalAmount), also fixed at
  // generation time — kept separate from principalAmount so a repayment can
  // recover exactly how much of `amount` is principal vs. fee vs. penalty
  // (penalty = amount - principalAmount - feeAmount, the only one of the
  // three that keeps growing after generation) and route each slice to its
  // own repository — see InstallmentsService.computeRepaymentSplit.
  @Column({ type: 'bigint' })
  feeAmount: string;

  @Column({ type: 'boolean', default: false })
  penaltyApplied: boolean;

  // How many days' worth of penaltyPercentPerDay have already been folded
  // into `amount` — lets applyOverduePenalties top up exactly the owed
  // difference each run instead of double-applying, regardless of how many
  // days have passed since the last sweep.
  @Column({ type: 'smallint', default: 0 })
  penaltyDaysApplied: number;

  // The day this installment was generated (WalletType.installmentDate).
  @Column({ type: 'date' })
  dueDate: string;

  // The day by which it must be paid before it's marked OVERDUE
  // (WalletType.paymentDeadlineDate) and the wallet gets blocked.
  @Column({ type: 'date' })
  deadlineDate: string;

  @Column({
    type: 'enum',
    enum: InstallmentStatus,
    enumName: 'installments_status_enum',
    default: InstallmentStatus.PENDING,
  })
  status: InstallmentStatus;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  paymentTransactionId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
