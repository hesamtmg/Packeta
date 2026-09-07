import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// One row per balanced set of GL postings — always produced alongside the
// Transaction (or a later event on it, like a rail settlement clearing) that
// caused it, via LedgerService. A single Transaction can end up with more
// than one journal entry over its lifetime (e.g. a WITHDRAW posts once at
// creation and, once its rail settlement resolves, again to move the amount
// from clearing to bank cash) — transactionId is therefore indexed, not
// unique.
@Entity('gl_journal_entries')
export class GlJournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  transactionId: string;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  // Set when this entry mirrors (reverses) an earlier one — a refund's
  // journal entry links back to the original PURCHASE's, rather than that
  // original being rewritten.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  reversalOfId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
