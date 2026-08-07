import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum PaymentIntentStatus {
  INITIATED = 'INITIATED',
  AUTHORIZED = 'AUTHORIZED',
  VERIFIED = 'VERIFIED',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
}

// A sandbox IPG: no real money or bank accounts here, this table just tracks
// the state machine of one payment page visit: INITIATED (merchant created
// it) -> AUTHORIZED (customer clicked Confirm on the pay page) -> VERIFIED
// (merchant's server-to-server /verify call redeemed it, one time only), or
// CANCELED (customer clicked Cancel) / EXPIRED (timeoutSeconds elapsed
// before the customer confirmed, or before the merchant verified).
@Entity('payment_intents')
export class PaymentIntent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  merchantName: string;

  // Minor units — only used to cross-check the merchant's /verify call
  // against what the customer was shown; the IPG never moves this money.
  @Column({ type: 'bigint' })
  amount: string;

  // Human-readable, pre-formatted by the merchant (e.g. "$12.34" or
  // "500,000 IRR") so this sandbox doesn't need its own currency table.
  @Column({ type: 'varchar', length: 50 })
  displayAmount: string;

  @Column({ type: 'varchar', length: 500 })
  callbackUrl: string;

  // Snapshot of the merchant wallet's profile at the moment this payment
  // page was created — the pay page renders these directly, so it doesn't
  // need a live lookup back into Packeta for merchant info to show.
  @Column({ type: 'varchar', length: 100, nullable: true })
  terminalId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  acceptorCode: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  storeSite: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  category: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  subCategory: string | null;

  @Column({
    type: 'enum',
    enum: PaymentIntentStatus,
    default: PaymentIntentStatus.INITIATED,
  })
  status: PaymentIntentStatus;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  authorizedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
