import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GlAccount } from './entities/gl-account.entity';
import { GlPosting } from './entities/gl-posting.entity';
import { GlJournalEntry } from './entities/gl-journal-entry.entity';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  currencyCode: string;
  debit: string;
  credit: string;
  net: string;
}

export interface AccountLedgerRow {
  postingId: string;
  direction: string;
  amount: string;
  journalEntryId: string;
  description: string;
  reversalOfId: string | null;
  transactionId: string;
  createdAt: Date;
}

// Read-only queries over the GL for the admin panel — never mutates
// anything, since gl_postings/gl_journal_entries are only ever written by
// LedgerService as a side effect of a real money movement (or the one-time
// backfill script).
@Injectable()
export class GlReportingService {
  constructor(
    @InjectRepository(GlAccount)
    private readonly accountsRepository: Repository<GlAccount>,
    @InjectRepository(GlPosting)
    private readonly postingsRepository: Repository<GlPosting>,
    @InjectRepository(GlJournalEntry)
    private readonly journalEntriesRepository: Repository<GlJournalEntry>,
  ) {}

  // One row per seeded account, every one of them — including accounts with
  // zero activity (e.g. FEE_REVENUE before any fee field ships) — so the
  // trial balance always shows the full chart of accounts, not just the
  // ones that happen to have postings.
  async getTrialBalance(): Promise<TrialBalanceRow[]> {
    const accounts = await this.accountsRepository.find({
      relations: { currency: true },
      order: { code: 'ASC' },
    });
    const totals = await this.postingsRepository
      .createQueryBuilder('posting')
      .select('posting.accountId', 'accountId')
      .addSelect(
        `SUM(CASE WHEN posting.direction = 'DEBIT' THEN posting.amount ELSE 0 END)`,
        'debit',
      )
      .addSelect(
        `SUM(CASE WHEN posting.direction = 'CREDIT' THEN posting.amount ELSE 0 END)`,
        'credit',
      )
      .groupBy('posting.accountId')
      .getRawMany<{ accountId: string; debit: string; credit: string }>();
    const totalsByAccount = new Map(totals.map((t) => [t.accountId, t]));

    return accounts.map((account) => {
      const totalsForAccount = totalsByAccount.get(account.id);
      const debit = BigInt(totalsForAccount?.debit ?? '0');
      const credit = BigInt(totalsForAccount?.credit ?? '0');
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        currencyCode: account.currency.code,
        debit: debit.toString(),
        credit: credit.toString(),
        net: (debit - credit).toString(),
      };
    });
  }

  // Every posting against one account, newest first, alongside its journal
  // entry's description and the transaction it came from — the drill-down
  // behind a trial-balance row.
  async getAccountLedger(
    accountId: string,
    limit = 100,
  ): Promise<AccountLedgerRow[]> {
    const rows = await this.postingsRepository
      .createQueryBuilder('posting')
      .innerJoin(GlJournalEntry, 'entry', 'entry.id = posting.journalEntryId')
      .where('posting.accountId = :accountId', { accountId })
      .select('posting.id', 'postingId')
      .addSelect('posting.direction', 'direction')
      .addSelect('posting.amount', 'amount')
      .addSelect('entry.id', 'journalEntryId')
      .addSelect('entry.description', 'description')
      .addSelect('entry.reversalOfId', 'reversalOfId')
      .addSelect('entry.transactionId', 'transactionId')
      .addSelect('entry.createdAt', 'createdAt')
      .orderBy('entry.createdAt', 'DESC')
      .addOrderBy('posting.createdAt', 'DESC')
      .limit(limit)
      .getRawMany<AccountLedgerRow>();
    return rows;
  }

  // Every journal entry posted for a given Transaction (usually one, but a
  // WITHDRAW can end up with two — see postCashMovement's clearing note —
  // and a refund's entry links back via reversalOfId), each with its full
  // set of postings. Backs the transaction detail view's "GL postings" tab.
  async getJournalEntriesForTransaction(transactionId: string): Promise<
    Array<{
      id: string;
      description: string;
      reversalOfId: string | null;
      createdAt: Date;
      postings: Array<{
        direction: string;
        amount: string;
        account: { code: string; name: string; currencyCode: string };
      }>;
    }>
  > {
    const entries = await this.journalEntriesRepository.find({
      where: { transactionId },
      order: { createdAt: 'ASC' },
    });
    if (!entries.length) return [];

    const postings = await this.postingsRepository
      .createQueryBuilder('posting')
      .innerJoin(GlAccount, 'account', 'account.id = posting.accountId')
      .innerJoin('account.currency', 'currency')
      .where('posting.journalEntryId IN (:...ids)', {
        ids: entries.map((e) => e.id),
      })
      .select('posting.journalEntryId', 'journalEntryId')
      .addSelect('posting.direction', 'direction')
      .addSelect('posting.amount', 'amount')
      .addSelect('account.code', 'accountCode')
      .addSelect('account.name', 'accountName')
      .addSelect('currency.code', 'currencyCode')
      .getRawMany<{
        journalEntryId: string;
        direction: string;
        amount: string;
        accountCode: string;
        accountName: string;
        currencyCode: string;
      }>();

    return entries.map((entry) => ({
      id: entry.id,
      description: entry.description,
      reversalOfId: entry.reversalOfId,
      createdAt: entry.createdAt,
      postings: postings
        .filter((p) => p.journalEntryId === entry.id)
        .map((p) => ({
          direction: p.direction,
          amount: p.amount,
          account: {
            code: p.accountCode,
            name: p.accountName,
            currencyCode: p.currencyCode,
          },
        })),
    }));
  }
}
