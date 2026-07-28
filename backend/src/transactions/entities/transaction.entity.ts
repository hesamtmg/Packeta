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
}

// Append-only ledger of completed money movements. Only successfully applied
// operations are written here; failed attempts are recorded in the Mongo
// activity log instead, keeping this table an authoritative financial record.
@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
