import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// The seeded set of built-in codes. The table itself is the source of truth
// (new codes can be added by inserting a row) — this is only used to seed
// defaults and to auto-create a starter wallet of each type on signup.
export enum WalletTypeCode {
  BUY = 'BUY',
  SELL = 'SELL',
  CREDIT = 'CREDIT',
  GIFT = 'GIFT',
}

// Each row is the "law" governing a wallet type: whether it can go negative
// (and how far), whether it can be cashed out, and whether it can send/receive
// peer-to-peer transfers. Balance floor enforcement lives in a DB trigger
// (see migration) that reads these columns, since a plain CHECK constraint
// can't reference another table.
@Entity('wallet_types')
export class WalletType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'boolean', default: false })
  allowNegativeBalance: boolean;

  // Max magnitude of negative balance allowed, in minor units. Only
  // meaningful when allowNegativeBalance is true.
  @Column({ type: 'bigint', nullable: true })
  creditLimit: string | null;

  @Column({ type: 'boolean', default: true })
  allowWithdraw: boolean;

  @Column({ type: 'boolean', default: false })
  allowP2pOut: boolean;

  @Column({ type: 'boolean', default: false })
  allowP2pIn: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
