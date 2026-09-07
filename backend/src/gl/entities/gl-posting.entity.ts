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

  // Which wallet this posting's amount belongs to — set for every
  // CUSTOMER_WALLETS/CREDIT_RECEIVABLE leg (including a repository
  // allocation mirror leg, itself tagged with the wallet it mirrors, not
  // the repository), null for a leg against a non-wallet account like
  // BANK_CASH or REPOSITORY_ALLOCATIONS. LedgerService.getWalletBalance
  // sums these to derive a wallet's balance instead of a stored column.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  walletId: string | null;

  @Column({ type: 'enum', enum: GlPostingDirection })
  direction: GlPostingDirection;

  @Column({ type: 'bigint' })
  amount: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
