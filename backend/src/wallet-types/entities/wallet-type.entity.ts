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
import { Currency } from '../../currencies/entities/currency.entity';

// The seeded set of built-in codes. The table itself is the source of truth
// (new codes can be added by inserting a row) — this is only used to seed
// defaults and to auto-create a starter wallet of each type on signup.
export enum WalletTypeCode {
  BUY = 'BUY',
  SELL = 'SELL',
  CREDIT = 'CREDIT',
  GIFT = 'GIFT',
  MERCHANT = 'MERCHANT',
}

// Each row is the "law" governing a wallet type: whether it can go negative
// (and how far), whether it can be cashed out, and whether it can send/receive
// peer-to-peer transfers. Balance floor enforcement lives in a DB trigger
// (see migration) that reads these columns, since a plain CHECK constraint
// can't reference another table.
//
// A type is denominated in exactly one currency — e.g. "Credit" for USD and
// "Credit" for IRR are two separate rows — because creditLimit is a flat
// number that only means something in one currency's scale. A wallet's
// currency is whatever its wallet type is denominated in; wallets don't carry
// their own currency field.
@Entity('wallet_types')
@Index(['code', 'currencyId'], { unique: true })
export class WalletType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'uuid' })
  currencyId: string;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  @Column({ type: 'boolean', default: false })
  allowNegativeBalance: boolean;

  // Max magnitude of negative balance allowed, in the type's currency's minor
  // units. Only meaningful when allowNegativeBalance is true.
  @Column({ type: 'bigint', nullable: true })
  creditLimit: string | null;

  @Column({ type: 'boolean', default: true })
  allowWithdraw: boolean;

  @Column({ type: 'boolean', default: false })
  allowP2pOut: boolean;

  @Column({ type: 'boolean', default: false })
  allowP2pIn: boolean;

  // Merchant-style types: eligible for the per-wallet auto-withdraw sweep
  // schedule, and/or able to send/receive a PURCHASE (customer -> merchant
  // only, never the reverse).
  @Column({ type: 'boolean', default: false })
  supportsAutoWithdraw: boolean;

  @Column({ type: 'boolean', default: false })
  allowPurchaseOut: boolean;

  @Column({ type: 'boolean', default: false })
  allowPurchaseIn: boolean;

  // Whether every new signup gets a starter wallet of this type (in the
  // default currency). Only the four original built-ins are starter types;
  // custom types (including Merchant) are opt-in via POST /wallets.
  @Column({ type: 'boolean', default: false })
  isStarterType: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
