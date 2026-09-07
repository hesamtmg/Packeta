import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum GlPostingDirection {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

// One leg of a GlJournalEntry. LedgerService.postEntry rejects any entry
// whose legs don't sum to zero (debits === credits) before insert — see that
// method for why this isn't also a DB-level constraint yet.
@Entity('gl_postings')
export class GlPosting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  journalEntryId: string;

  @Index()
  @Column({ type: 'uuid' })
  accountId: string;

  @Column({ type: 'enum', enum: GlPostingDirection })
  direction: GlPostingDirection;

  @Column({ type: 'bigint' })
  amount: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
