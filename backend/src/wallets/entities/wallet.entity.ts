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

  // Merchant wallets only: exactly 3 "HH:MM" times (server-local) at which
  // the full balance is auto-swept out. Set at creation, only meaningful
  // when the wallet type's supportsAutoWithdraw is true.
  @Column({ type: 'varchar', length: 5, array: true, nullable: true })
  autoWithdrawTimes: string[] | null;

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
