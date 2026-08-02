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

// One scheduled repayment of a credit wallet's granted virtualAmount back to
// its repository — see InstallmentsService (generation + overdue sweep) and
// TransactionsService.payInstallment (repayment, via the same IPG purchase
// flow as any other purchase, paid into the repository's real balance).
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

  // The VIRTUAL transaction that granted this wallet the credit ceiling this
  // installment plan repays (see WalletsService.grantCredit) — the fixed,
  // never-mutated source InstallmentsService.generateDue splits across the
  // schedule, unlike the wallet's live virtualAmount ceiling, which
  // fluctuates as it's spent and repaid. Also how generateDue tells which
  // grants already have their installmentCount rows generated.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  sourceTransactionId: string | null;

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
