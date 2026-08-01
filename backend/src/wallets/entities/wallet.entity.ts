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
import { User } from '../../users/entities/user.entity';
import { WalletType } from '../../wallet-types/entities/wallet-type.entity';

// balance is stored in minor units (e.g. cents) as a bigint to avoid float
// rounding errors; typeorm maps postgres bigint to a JS string. A user can
// hold several wallets of the same type. The balance floor (0, or
// -creditLimit for types that allow going negative) is enforced by a DB
// trigger keyed off walletTypeId — see the AddWalletTypesAndMultiWallet
// migration — since a static CHECK constraint can't reference another table.
@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Index()
  @Column({ type: 'uuid' })
  walletTypeId: string;

  @ManyToOne(() => WalletType)
  @JoinColumn({ name: 'walletTypeId' })
  walletType: WalletType;

  @Column({ type: 'bigint', default: 0 })
  balance: string;

  // Merchant wallets only: how long a PURCHASE stays PENDING awaiting the
  // merchant's /verify call before the timeout sweep auto-reverses it. Set
  // at creation, only meaningful when the wallet type's allowPurchaseIn is
  // true.
  @Column({ type: 'int', nullable: true })
  purchaseTimeoutSeconds: number | null;

  // A closed marketplace: if set (non-empty), this wallet may only transfer
  // to or purchase from/be purchased from a counterparty whose email is in
  // this list — see WalletsService.isCounterpartyAllowed for the exact
  // "either side's own list is enough" rule. Null/empty means unrestricted
  // (today's default behavior).
  @Column({ type: 'varchar', length: 255, array: true, nullable: true })
  restrictedCounterparties: string[] | null;

  // Set once a zero-balance wallet is closed (soft-delete — a wallet with
  // any transaction history can never be hard-deleted, since transactions
  // reference it by FK and are themselves permanent). A closed wallet stays
  // visible for its history but is excluded from every money-movement path:
  // it can't send/receive deposits, withdrawals, transfers, or purchases.
  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  // Merchant wallets only: the payment-switch (e.g. Shaparak) terminal and
  // acceptor identifiers this wallet settles under. Purely descriptive on
  // our side — nothing in the sandbox IPG validates or uses these — but
  // recorded so a merchant's real-world PSP configuration is visible
  // alongside the wallet that represents it.
  @Column({ type: 'varchar', length: 100, nullable: true })
  terminalId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  acceptorCode: string | null;

  // Every wallet: an optional per-transaction amount band (minor units),
  // checked against deposit/withdraw/transfer/purchase amounts that touch
  // this wallet — see WalletsService.assertWithinTransactionLimits.
  @Column({ type: 'bigint', nullable: true })
  minTransactionAmount: string | null;

  @Column({ type: 'bigint', nullable: true })
  maxTransactionAmount: string | null;

  // Merchant wallets only: storefront identity shown on the IPG pay page in
  // place of the merchant's raw email/phone, and access controls enforced on
  // self-service charge creation (POST /transactions/purchase/charge) — see
  // TransactionsService.initiateCharge.
  @Column({ type: 'varchar', length: 150, nullable: true })
  storeName: string | null;

  // The merchant's own site — shown on the IPG pay page, and (best-effort,
  // only when the request carries an Origin/Referer header at all) checked
  // against self-service charge creation requests.
  @Column({ type: 'varchar', length: 500, nullable: true })
  storeSite: string | null;

  // Allowlist of IPs permitted to call self-service charge creation on this
  // merchant's behalf. Null/empty means unrestricted.
  @Column({ type: 'varchar', length: 64, array: true, nullable: true })
  allowedIps: string[] | null;

  // The merchant's own webhook: notified (fire-and-forget, best-effort) once
  // a purchase into this wallet completes — see
  // TransactionsService.notifyMerchantCallback.
  @Column({ type: 'varchar', length: 500, nullable: true })
  callbackUrl: string | null;

  // Purely descriptive merchant classification (e.g. "Retail" / "Groceries")
  // — not enforced anywhere, shown in the admin panel.
  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  subCategory: string | null;

  // Credit-line fields (repository/credit wallet feature). Only meaningful
  // on wallets of a credit-style type — the shared billing rules (fee,
  // penalty, installment schedule, etc.) live on WalletType instead, since
  // those are the same for every wallet of the type; these two differ per
  // person.
  //
  // The virtual (allocatable, not directly spendable) balance a repository
  // owner has granted this specific wallet, in minor units.
  @Column({ type: 'bigint', nullable: true })
  virtualAmount: string | null;

  // Iranian national ID of this wallet's holder.
  @Column({ type: 'varchar', length: 10, nullable: true })
  nationalCode: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
