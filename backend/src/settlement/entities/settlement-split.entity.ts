import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum SettlementSplitType {
  PERCENT = 'PERCENT',
  FIXED = 'FIXED',
}

// Where a merchant's incoming purchase money should be paid out to at
// settlement time (the auto-withdraw sweep), split across one or more IBANs.
// A row belongs to exactly one of two owners — never both, never neither
// (enforced by a DB CHECK):
//   - walletId set: the merchant wallet's own default split, configured at
//     wallet creation, used for any purchase that doesn't specify its own.
//   - transactionId set: a one-off override supplied by the merchant when
//     creating that specific charge (POST /transactions/purchase/charge),
//     which takes priority over the wallet's default for that purchase only.
// fromWalletId/toWalletId elsewhere in this codebase are plain uuid columns
// with no TypeORM relation object (see Transaction) — walletId/transactionId
// here follow the same convention, so this file never has to import the
// Wallet or Transaction entity.
@Entity('settlement_splits')
export class SettlementSplit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  walletId: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  transactionId: string | null;

  @Column({ type: 'varchar', length: 34 })
  iban: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string | null;

  @Column({ type: 'enum', enum: SettlementSplitType })
  splitType: SettlementSplitType;

  // Set only when splitType is PERCENT (0.001-100). Wallet-level defaults
  // are always PERCENT — a fixed amount can't be validated against a
  // purchase whose amount isn't known yet at wallet-creation time.
  @Column({ type: 'numeric', precision: 6, scale: 3, nullable: true })
  percentValue: string | null;

  // Set only when splitType is FIXED (minor units, e.g. cents) — only valid
  // on a per-charge override, since the charge already fixes the amount
  // these need to sum to exactly.
  @Column({ type: 'bigint', nullable: true })
  fixedAmount: string | null;

  // Stable display/processing order within one owner's split set.
  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
