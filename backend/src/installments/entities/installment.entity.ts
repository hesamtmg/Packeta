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

  // 1-based position within the credit line's WalletType.installmentCount
  // schedule.
  @Column({ type: 'smallint' })
  sequenceNumber: number;

  // Principal share (virtualAmount / installmentCount, remainder folded into
  // the last installment) plus the type's flat fee, in minor units. Grows by
  // the type's penalty once the installment goes OVERDUE.
  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'boolean', default: false })
  penaltyApplied: boolean;

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
