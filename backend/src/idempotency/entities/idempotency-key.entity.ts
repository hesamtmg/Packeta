import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum IdempotencyStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

// Claims a client-supplied Idempotency-Key before any wallet mutation runs.
// The unique PK on `key` is what makes concurrent duplicate requests block on
// each other instead of double-processing; the row is inserted IN_PROGRESS in
// the same DB transaction as the ledger write, then flipped to COMPLETED with
// the cached response once that transaction commits.
@Entity('idempotency_keys')
export class IdempotencyKey {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  key: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 64 })
  endpoint: string;

  @Column({ type: 'varchar', length: 64 })
  requestHash: string;

  @Column({
    type: 'enum',
    enum: IdempotencyStatus,
    default: IdempotencyStatus.IN_PROGRESS,
  })
  status: IdempotencyStatus;

  @Column({ type: 'jsonb', nullable: true })
  responseBody: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
