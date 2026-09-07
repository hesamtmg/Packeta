import { GlReportingService } from './gl-reporting.service';
import { GlAccountCode, GlAccountType } from './entities/gl-account.entity';

function accountsRepo(accounts: any[]) {
  return { find: jest.fn().mockResolvedValue(accounts) };
}

function queryBuilderRepo(rawRows: any[]) {
  const builder: any = {
    select: () => builder,
    addSelect: () => builder,
    where: () => builder,
    groupBy: () => builder,
    orderBy: () => builder,
    addOrderBy: () => builder,
    limit: () => builder,
    innerJoin: () => builder,
    getRawMany: jest.fn().mockResolvedValue(rawRows),
  };
  return { createQueryBuilder: jest.fn(() => builder), builder };
}

describe('GlReportingService.getTrialBalance', () => {
  it('shows every seeded account, defaulting to zero when it has no postings', async () => {
    const accounts = [
      {
        id: 'acc-bank-usd',
        code: GlAccountCode.BANK_CASH,
        name: 'Bank Cash (USD)',
        type: GlAccountType.ASSET,
        currency: { code: 'USD' },
      },
      {
        id: 'acc-fee-usd',
        code: GlAccountCode.FEE_REVENUE,
        name: 'Fee Revenue (USD)',
        type: GlAccountType.REVENUE,
        currency: { code: 'USD' },
      },
    ];
    const postingsRepo = queryBuilderRepo([
      { accountId: 'acc-bank-usd', debit: '1600', credit: '200' },
    ]);
    const service = new GlReportingService(
      accountsRepo(accounts) as any,
      postingsRepo as any,
      {} as any,
    );

    const result = await service.getTrialBalance();

    expect(result).toEqual([
      {
        accountId: 'acc-bank-usd',
        code: GlAccountCode.BANK_CASH,
        name: 'Bank Cash (USD)',
        type: GlAccountType.ASSET,
        currencyCode: 'USD',
        debit: '1600',
        credit: '200',
        net: '1400',
      },
      {
        accountId: 'acc-fee-usd',
        code: GlAccountCode.FEE_REVENUE,
        name: 'Fee Revenue (USD)',
        type: GlAccountType.REVENUE,
        currencyCode: 'USD',
        debit: '0',
        credit: '0',
        net: '0',
      },
    ]);
  });
});

describe('GlReportingService.getAccountLedger', () => {
  it('returns the raw postings joined with their journal entry', async () => {
    const rows = [
      {
        postingId: 'p-1',
        direction: 'DEBIT',
        amount: '500',
        journalEntryId: 'j-1',
        description: 'Purchase',
        reversalOfId: null,
        transactionId: 'tx-1',
        createdAt: new Date('2024-01-01'),
      },
    ];
    const postingsRepo = queryBuilderRepo(rows);
    const service = new GlReportingService(
      {} as any,
      postingsRepo as any,
      {} as any,
    );

    const result = await service.getAccountLedger('acc-1');

    expect(result).toEqual(rows);
    expect(postingsRepo.createQueryBuilder).toHaveBeenCalledWith('posting');
  });
});

describe('GlReportingService.getJournalEntriesForTransaction', () => {
  it('returns an empty array when the transaction has no journal entries', async () => {
    const journalEntriesRepo = { find: jest.fn().mockResolvedValue([]) };
    const service = new GlReportingService(
      {} as any,
      {} as any,
      journalEntriesRepo as any,
    );

    const result = await service.getJournalEntriesForTransaction('tx-none');

    expect(result).toEqual([]);
  });

  it('groups postings under their journal entry', async () => {
    const journalEntriesRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'j-1',
          description: 'Purchase',
          reversalOfId: null,
          createdAt: new Date('2024-01-01'),
        },
      ]),
    };
    const postingsRepo = queryBuilderRepo([
      {
        journalEntryId: 'j-1',
        direction: 'DEBIT',
        amount: '300',
        accountCode: GlAccountCode.CUSTOMER_WALLETS,
        accountName: 'Customer Wallets (USD)',
        currencyCode: 'USD',
      },
      {
        journalEntryId: 'j-1',
        direction: 'CREDIT',
        amount: '300',
        accountCode: GlAccountCode.CUSTOMER_WALLETS,
        accountName: 'Customer Wallets (USD)',
        currencyCode: 'USD',
      },
    ]);
    const service = new GlReportingService(
      {} as any,
      postingsRepo as any,
      journalEntriesRepo as any,
    );

    const result = await service.getJournalEntriesForTransaction('tx-1');

    expect(result).toHaveLength(1);
    expect(result[0].postings).toHaveLength(2);
    expect(result[0].postings[0]).toEqual({
      direction: 'DEBIT',
      amount: '300',
      account: {
        code: GlAccountCode.CUSTOMER_WALLETS,
        name: 'Customer Wallets (USD)',
        currencyCode: 'USD',
      },
    });
  });
});
