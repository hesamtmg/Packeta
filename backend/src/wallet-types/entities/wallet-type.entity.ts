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
  // A "money repository": a big real+virtual balance a business/corporate
  // user holds, then splits out to personnel as CREDIT wallets — see
  // WalletsService.grantCredit.
  REPOSITORY = 'REPOSITORY',
  // Auto-provisioned only (never created directly by a user or admin) — see
  // WalletsService.findOrCreateSupportWallet. Holds the real money a
  // customer pays via ZarinPal to cover the gap when a CREDIT purchase
  // exceeds what its credit line + backing repository can fund.
  SUPPORT = 'SUPPORT',
  // A purchase destination for a CREDIT type's fee/penalty/unblock-fee
  // revenue (see WalletType.feeRepositoryWalletId etc. below and
  // TransactionsService's repayment-splitting) — unlike REPOSITORY, it never
  // funds a credit line and is free to allow manual withdrawals, just never
  // the scheduled auto-withdraw sweep (see WalletTypesService's
  // MERCHANT_REPOSITORY check).
  MERCHANT_REPOSITORY = 'MERCHANT_REPOSITORY',
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

  // Merchant-style types: eligible for the auto-withdraw sweep schedule,
  // and/or able to send/receive a PURCHASE (customer -> merchant only,
  // never the reverse).
  @Column({ type: 'boolean', default: false })
  supportsAutoWithdraw: boolean;

  // Exactly 3 "HH:MM" (server-local) times at which every wallet of this
  // type has its full balance auto-swept out via a plain WITHDRAW. Only
  // meaningful when supportsAutoWithdraw is true — shared by every wallet of
  // this type, not configurable per wallet.
  @Column({ type: 'varchar', length: 5, array: true, nullable: true })
  autoWithdrawTimes: string[] | null;

  @Column({ type: 'boolean', default: false })
  allowPurchaseOut: boolean;

  @Column({ type: 'boolean', default: false })
  allowPurchaseIn: boolean;

  // Whether the self-service Deposit action is allowed on wallets of this
  // type at all.
  @Column({ type: 'boolean', default: true })
  depositable: boolean;

  // Credit-line fields (repository/credit wallet feature). All nullable and
  // only meaningful on the CREDIT-style types this feature applies to —
  // unused on every other type. The actual virtual balance granted and the
  // holder's national code are per-wallet (see Wallet entity), since they
  // differ per person — these are the shared billing rules every wallet of
  // the type follows.
  //
  // Day of month (1-31) each billing cycle's installment is generated.
  @Column({ type: 'smallint', nullable: true })
  installmentDate: number | null;

  // Day of month (1-31) by which a generated installment must be paid.
  @Column({ type: 'smallint', nullable: true })
  paymentDeadlineDate: number | null;

  // Fee charged per installment, as a percentage (0-100, up to 3 decimal
  // places) of that installment's principal share — computed once at
  // generation time (see InstallmentsService.generateDue).
  @Column({ type: 'numeric', precision: 6, scale: 3, nullable: true })
  feePercent: string | null;

  // Penalty accrued for every day an installment stays unpaid past its
  // deadline, as a percentage (0-100, up to 3 decimal places) of that
  // installment's principal share — applied once per elapsed day, not
  // compounding on itself (see InstallmentsService.applyOverduePenalties).
  @Column({ type: 'numeric', precision: 6, scale: 3, nullable: true })
  penaltyPercentPerDay: string | null;

  // Flat fee charged to unblock a wallet frozen for missed payment, in minor
  // units.
  @Column({ type: 'bigint', nullable: true })
  unblockFee: string | null;

  // How many installments each credit line is split into.
  @Column({ type: 'smallint', nullable: true })
  installmentCount: number | null;

  // How many days an installment may sit OVERDUE (accruing
  // penaltyPercentPerDay) before the wallet is actually blocked and the
  // admin notified — see InstallmentsService.applyOverduePenalties. Missing
  // its deadline alone no longer blocks the wallet immediately; only
  // crossing this many days unpaid past that does. Null disables
  // day-count-based blocking for this type entirely (penalty still
  // accrues, the wallet just never auto-blocks).
  @Column({ type: 'smallint', nullable: true })
  overdueDaysBeforeBlock: number | null;

  // Where an installment repayment's fee/penalty/unblock-fee slices land
  // instead of the credit wallet's own backing repository — each must be a
  // MERCHANT_REPOSITORY-type wallet in the same currency (see
  // WalletTypesService's validation). Null leaves that slice on the main
  // repository, same as before this feature existed — see
  // TransactionsService's repayment-splitting (verifyPurchase's real-money-in
  // branch and collectOverdueFromRepository).
  @Column({ type: 'uuid', nullable: true })
  feeRepositoryWalletId: string | null;

  @Column({ type: 'uuid', nullable: true })
  penaltyRepositoryWalletId: string | null;

  @Column({ type: 'uuid', nullable: true })
  unblockFeeRepositoryWalletId: string | null;

  // Whether every new signup gets a starter wallet of this type (in the
  // default currency). Only the four original built-ins are starter types;
  // custom types (including Merchant) are opt-in via POST /wallets.
  @Column({ type: 'boolean', default: false })
  isStarterType: boolean;

  // Whether a wallet of this type may carry a manually-set virtual balance
  // (Wallet.virtualAmount) at creation — e.g. a REPOSITORY wallet's funding
  // pool. Off by default; doesn't affect CREDIT wallets, whose virtualAmount
  // is set internally by WalletsService.grantCredit rather than through the
  // generic create/update endpoints this flag gates.
  @Column({ type: 'boolean', default: false })
  hasVirtualBalance: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
