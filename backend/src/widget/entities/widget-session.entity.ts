import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WidgetSessionStatus {
  PENDING = 'PENDING',
  AUTHENTICATED = 'AUTHENTICATED',
  EXPIRED = 'EXPIRED',
}

// A short-lived, narrowly-scoped credential a merchant's own backend mints
// server-to-server (see WidgetController.createSession) and hands to their
// frontend, which is the only thing their embedded widget ever needs — the
// same "authority"-scoped-token shape the purchase flow already uses (see
// Transaction.ipgAuthority), just for viewing wallets instead of paying.
// Everything that resolves this session to a real customer (OTP or the
// non-OTP trusted path) runs inside Packeta's own hosted widget iframe,
// keyed by `token` — the merchant's page never sees it.
@Entity('widget_sessions')
export class WidgetSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The MERCHANT wallet this session was minted for — resolves which
  // merchant/store identity the widget shows, and (via its walletType)
  // whether OTP is required.
  @Index()
  @Column({ type: 'uuid' })
  walletId: string;

  @Index({ unique: true })
  @Column({ type: 'varchar' })
  token: string;

  // Set when the merchant's backend already knows the customer's phone
  // number at session-creation time — required for the non-OTP ("trusted")
  // path, and used to skip the phone-entry step even in OTP mode.
  @Column({ type: 'varchar', nullable: true })
  phoneNumber: string | null;

  // Resolved once the session authenticates (via OTP verify or the
  // non-OTP authenticate call) — null until then.
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({
    type: 'enum',
    enum: WidgetSessionStatus,
    default: WidgetSessionStatus.PENDING,
  })
  status: WidgetSessionStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;
}
