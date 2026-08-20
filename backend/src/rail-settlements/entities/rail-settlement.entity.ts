import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Iran has no single "bank transfer" — money leaves a merchant wallet over
// one of a few interbank rails, each with its own processing-window
// schedule (see rail-schedule.ts):
//   - POL_PAY: a real-time-ish PSP bridge — near-continuous availability.
//   - PAYA: CBI's batch ACH-style clearing — settles a few times a day.
//   - SATNA: CBI's RTGS — larger amounts, cuts off mid-afternoon.
//   - BANK_TRANSFER: a direct intra/inter-bank transfer whose timing is
//     entirely bank-specific — no sensible default, must be configured
//     explicitly (see Wallet.railScheduleTimes).
export enum SettlementRailType {
  POL_PAY = 'POL_PAY',
  PAYA = 'PAYA',
  SATNA = 'SATNA',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

export enum RailSettlementStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// One row per payout the rail-settlement sweep sends out — the audit trail
// of "this money left via this rail, at this scheduled window." Each row is
// paired 1:1 with the WITHDRAW Transaction it produced (see
// TransactionsService.sweepAutoWithdraw's rail-aware branch): the WITHDRAW
// carries the actual ledger movement (same balance/idempotency mechanics as
// any other withdrawal), while this row carries the rail-specific metadata
// a plain Transaction has no fields for.
@Entity('rail_settlements')
export class RailSettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  walletId: string;

  @Column({ type: 'enum', enum: SettlementRailType })
  railType: SettlementRailType;

  @Column({ type: 'bigint' })
  amount: string;

  @Column({ type: 'varchar', length: 34, nullable: true })
  destinationIban: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string | null;

  @Column({
    type: 'enum',
    enum: RailSettlementStatus,
    default: RailSettlementStatus.COMPLETED,
  })
  status: RailSettlementStatus;

  // The rail schedule window ("HH:MM", today's date) this payout was
  // triggered by.
  @Column({ type: 'timestamptz' })
  scheduledFor: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  // The mocked rail provider's own reference for this payout, and its raw
  // response payload — persisted so it survives until the real PAYA/SATNA/
  // Pol Pay/bank-transfer APIs replace RailProviderClient's mock
  // implementations (see providers/*.provider.ts). Each rail's real
  // response shape differs, hence the untyped jsonb rather than dedicated
  // columns.
  @Column({ type: 'varchar', length: 100, nullable: true })
  providerReference: string | null;

  @Column({ type: 'jsonb', nullable: true })
  providerResponse: Record<string, unknown> | null;

  // The resulting WITHDRAW Transaction — see Transaction.railSettlementId
  // for the reverse link.
  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  transactionId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
