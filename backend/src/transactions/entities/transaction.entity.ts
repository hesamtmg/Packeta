import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum TransactionType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAW = 'WITHDRAW',
  TRANSFER = 'TRANSFER',
  ADJUSTMENT = 'ADJUSTMENT',
  PURCHASE = 'PURCHASE',
}

// Every DEPOSIT/WITHDRAW/TRANSFER/ADJUSTMENT row is COMPLETED the instant
// it's inserted (the ledger's original guarantee: only successfully applied
// operations are written here, failed attempts go to the Mongo activity log
// instead). PURCHASE is the one type that can sit PENDING — funds are held
// from the customer at initiate time but not yet credited to the merchant
// until /verify — and can end as REVERSED if the merchant never verifies
// before purchaseTimeoutSeconds, or via an explicit refund.
export enum TransactionStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  REVERSED = 'REVERSED',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.COMPLETED,
  })
  status: TransactionStatus;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  fromWalletId: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  toWalletId: string | null;

  @Column({ type: 'bigint' })
  amount: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  idempotencyKey: string;

  // Only set for ADJUSTMENT rows: the admin's explanation for the correction.
  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  // Only set for ADJUSTMENT rows: which admin performed it.
  @Column({ type: 'uuid', nullable: true })
  performedByUserId: string | null;

  // Only set for PENDING PURCHASE rows: the deadline for the merchant to
  // call /verify before the timeout sweep auto-reverses it.
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  // Only set on a REVERSED row's counterpart (or vice versa): links a
  // reversal to the PURCHASE it reverses.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  relatedTransactionId: string | null;

  // Only set for PURCHASE rows: the external IPG's payment intent id and
  // the payment page URL the customer was redirected to. No balance moves
  // when these are set — only once /verify confirms the IPG authorized it.
  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  ipgAuthority: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  ipgPaymentUrl: string | null;

  // Only set for PURCHASE rows created via the merchant-initiated charge
  // flow: which language the IPG pay page should render in for the
  // customer identifying themselves there, chosen by the merchant at
  // charge-creation time.
  @Column({ type: 'varchar', length: 5, nullable: true })
  language: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
