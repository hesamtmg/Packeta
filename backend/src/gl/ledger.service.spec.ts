import { LedgerService } from './ledger.service';
import { GlAccount, GlAccountCode, GlAccountType } from './entities/gl-account.entity';
import { GlPostingDirection } from './entities/gl-posting.entity';
import { WalletType } from '../wallet-types/entities/wallet-type.entity';

const USD_ID = 'currency-usd';

function account(
  code: GlAccountCode,
  type: GlAccountType,
  currencyId = USD_ID,
): GlAccount {
  return {
    id: `account-${code}-${currencyId}`,
    code,
    name: code,
    type,
    currencyId,
    currency: undefined as any,
    createdAt: new Date(),
  };
}

const SEEDED_ACCOUNTS: GlAccount[] = [
  account(GlAccountCode.BANK_CASH, GlAccountType.ASSET),
  account(GlAccountCode.CUSTOMER_WALLETS, GlAccountType.LIABILITY),
  account(GlAccountCode.CREDIT_RECEIVABLE, GlAccountType.ASSET),
  account(GlAccountCode.SETTLEMENT_CLEARING, GlAccountType.LIABILITY),
  account(GlAccountCode.FEE_REVENUE, GlAccountType.REVENUE),
  account(GlAccountCode.LEDGER_ADJUSTMENTS, GlAccountType.EQUITY),
];

function buildManager(
  accounts: GlAccount[] = SEEDED_ACCOUNTS,
  existingJournalEntries: Array<{ id: string; transactionId: string }> = [],
) {
  const savedPostings: any[] = [];
  const savedEntries: any[] = [];
  let idCounter = 0;
  const manager = {
    findOne: jest.fn(async (_entity: unknown, opts: any) => {
      if (opts.where.code !== undefined) {
        return (
          accounts.find(
            (a) =>
              a.code === opts.where.code &&
              a.currencyId === opts.where.currencyId,
          ) ?? null
        );
      }
      return (
        existingJournalEntries.find(
          (e) => e.transactionId === opts.where.transactionId,
        ) ?? null
      );
    }),
    create: jest.fn((_entity: unknown, data: any) => ({
      ...data,
      id: data.id ?? `row-${++idCounter}`,
    })),
    save: jest.fn(async (data: any) => {
      if (Array.isArray(data)) {
        savedPostings.push(...data);
      } else {
        savedEntries.push(data);
      }
      return data;
    }),
  };
  return { manager, savedPostings, savedEntries };
}

function walletType(overrides: Partial<WalletType> = {}): WalletType {
  return {
    id: 'wallet-type-1',
    code: 'BUY',
    name: 'Buy',
    currencyId: USD_ID,
    currency: undefined as any,
    allowNegativeBalance: false,
    creditLimit: null,
    allowWithdraw: true,
    allowP2pOut: false,
    allowP2pIn: false,
    supportsAutoWithdraw: false,
    autoWithdrawTimes: null,
    allowPurchaseOut: false,
    allowPurchaseIn: false,
    depositable: true,
    installmentDate: null,
    paymentDeadlineDate: null,
    feePercent: null,
    penaltyPercentPerDay: null,
    unblockFee: null,
    installmentCount: null,
    overdueDaysBeforeBlock: null,
    feeRepositoryWalletId: null,
    penaltyRepositoryWalletId: null,
    unblockFeeRepositoryWalletId: null,
    isStarterType: false,
    hasVirtualBalance: false,
    hiddenFromCustomer: false,
    allowWidget: false,
    widgetRequiresOtp: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as WalletType;
}

describe('LedgerService', () => {
  it('maps a normal wallet type to CUSTOMER_WALLETS and a credit-line type to CREDIT_RECEIVABLE', () => {
    const service = new LedgerService();
    expect(service.walletAccountCode(walletType())).toBe(
      GlAccountCode.CUSTOMER_WALLETS,
    );
    expect(
      service.walletAccountCode(walletType({ allowNegativeBalance: true })),
    ).toBe(GlAccountCode.CREDIT_RECEIVABLE);
  });

  it('postCashMovement on a deposit debits cash and credits the wallet-mapped account', async () => {
    const service = new LedgerService();
    const { manager, savedPostings } = buildManager();

    await service.postCashMovement(
      manager as any,
      'tx-1',
      'Deposit',
      walletType(),
      1000n,
      GlAccountCode.BANK_CASH,
    );

    expect(savedPostings).toHaveLength(2);
    const bankLeg = savedPostings.find(
      (p) => p.accountId === `account-${GlAccountCode.BANK_CASH}-${USD_ID}`,
    );
    const walletLeg = savedPostings.find(
      (p) =>
        p.accountId === `account-${GlAccountCode.CUSTOMER_WALLETS}-${USD_ID}`,
    );
    expect(bankLeg).toMatchObject({
      direction: GlPostingDirection.DEBIT,
      amount: '1000',
    });
    expect(walletLeg).toMatchObject({
      direction: GlPostingDirection.CREDIT,
      amount: '1000',
    });
  });

  it('postCashMovement on a withdrawal debits the wallet-mapped account and credits cash', async () => {
    const service = new LedgerService();
    const { manager, savedPostings } = buildManager();

    await service.postCashMovement(
      manager as any,
      'tx-1',
      'Withdraw',
      walletType(),
      -500n,
      GlAccountCode.SETTLEMENT_CLEARING,
    );

    const clearingLeg = savedPostings.find(
      (p) =>
        p.accountId === `account-${GlAccountCode.SETTLEMENT_CLEARING}-${USD_ID}`,
    );
    const walletLeg = savedPostings.find(
      (p) =>
        p.accountId === `account-${GlAccountCode.CUSTOMER_WALLETS}-${USD_ID}`,
    );
    expect(walletLeg).toMatchObject({
      direction: GlPostingDirection.DEBIT,
      amount: '500',
    });
    expect(clearingLeg).toMatchObject({
      direction: GlPostingDirection.CREDIT,
      amount: '500',
    });
  });

  it('postCashInMultiLeg debits cash once and splits the credit across several wallets', async () => {
    const service = new LedgerService();
    const { manager, savedPostings } = buildManager();
    const repositoryType = walletType({ name: 'Repository' });
    const feeRepoType = walletType({ name: 'Fee repo' });

    await service.postCashInMultiLeg(
      manager as any,
      'tx-1',
      'Installment repayment',
      GlAccountCode.BANK_CASH,
      USD_ID,
      400n,
      [
        { walletType: repositoryType, amount: 350n },
        { walletType: feeRepoType, amount: 50n },
      ],
    );

    expect(savedPostings).toHaveLength(3);
    const bankLeg = savedPostings.find(
      (p) => p.accountId === `account-${GlAccountCode.BANK_CASH}-${USD_ID}`,
    );
    expect(bankLeg).toMatchObject({
      direction: GlPostingDirection.DEBIT,
      amount: '400',
    });
    const totalCredit = savedPostings
      .filter((p) => p.direction === GlPostingDirection.CREDIT)
      .reduce((sum: bigint, p: any) => sum + BigInt(p.amount), 0n);
    expect(totalCredit).toBe(400n);
  });

  it('a repayment into a CREDIT wallet credits (shrinks) CREDIT_RECEIVABLE rather than CUSTOMER_WALLETS', async () => {
    const service = new LedgerService();
    const { manager, savedPostings } = buildManager();

    await service.postCashMovement(
      manager as any,
      'tx-1',
      'Installment repayment',
      walletType({ allowNegativeBalance: true }),
      300n,
      GlAccountCode.BANK_CASH,
    );

    const receivableLeg = savedPostings.find(
      (p) =>
        p.accountId === `account-${GlAccountCode.CREDIT_RECEIVABLE}-${USD_ID}`,
    );
    expect(receivableLeg).toMatchObject({
      direction: GlPostingDirection.CREDIT,
      amount: '300',
    });
  });

  it('a draw against a CREDIT wallet debits (grows) CREDIT_RECEIVABLE', async () => {
    const service = new LedgerService();
    const { manager, savedPostings } = buildManager();

    await service.postWalletToWallet(
      manager as any,
      'tx-1',
      'Credit-funded purchase',
      walletType({ allowNegativeBalance: true }),
      walletType(),
      200n,
    );

    const receivableLeg = savedPostings.find(
      (p) =>
        p.accountId === `account-${GlAccountCode.CREDIT_RECEIVABLE}-${USD_ID}`,
    );
    const walletLeg = savedPostings.find(
      (p) =>
        p.accountId === `account-${GlAccountCode.CUSTOMER_WALLETS}-${USD_ID}`,
    );
    expect(receivableLeg).toMatchObject({ direction: GlPostingDirection.DEBIT });
    expect(walletLeg).toMatchObject({ direction: GlPostingDirection.CREDIT });
  });

  it('postAdjustment posts the opposite leg to LEDGER_ADJUSTMENTS', async () => {
    const service = new LedgerService();
    const { manager, savedPostings } = buildManager();

    await service.postAdjustment(
      manager as any,
      'tx-1',
      'Manual correction',
      walletType(),
      -50n,
    );

    const suspenseLeg = savedPostings.find(
      (p) =>
        p.accountId === `account-${GlAccountCode.LEDGER_ADJUSTMENTS}-${USD_ID}`,
    );
    const walletLeg = savedPostings.find(
      (p) =>
        p.accountId === `account-${GlAccountCode.CUSTOMER_WALLETS}-${USD_ID}`,
    );
    expect(walletLeg).toMatchObject({
      direction: GlPostingDirection.DEBIT,
      amount: '50',
    });
    expect(suspenseLeg).toMatchObject({
      direction: GlPostingDirection.CREDIT,
      amount: '50',
    });
  });

  it('postMultiLeg debits several wallets and credits one, staying balanced', async () => {
    const service = new LedgerService();
    const { manager, savedPostings } = buildManager();
    const repositoryType = walletType({ name: 'Repository' });
    const supportType = walletType({ name: 'Support' });
    const merchantType = walletType({ name: 'Merchant' });

    await service.postMultiLeg(
      manager as any,
      'tx-1',
      'Purchase',
      [
        { walletType: supportType, amount: 50n },
        { walletType: repositoryType, amount: 100n },
      ],
      [{ walletType: merchantType, amount: 150n }],
    );

    expect(savedPostings).toHaveLength(3);
    const totalDebit = savedPostings
      .filter((p) => p.direction === GlPostingDirection.DEBIT)
      .reduce((sum: bigint, p: any) => sum + BigInt(p.amount), 0n);
    const totalCredit = savedPostings
      .filter((p) => p.direction === GlPostingDirection.CREDIT)
      .reduce((sum: bigint, p: any) => sum + BigInt(p.amount), 0n);
    expect(totalDebit).toBe(150n);
    expect(totalCredit).toBe(150n);
  });

  it('postMultiLeg drops zero-amount legs instead of rejecting them', async () => {
    const service = new LedgerService();
    const { manager, savedPostings } = buildManager();

    await service.postMultiLeg(
      manager as any,
      'tx-1',
      'Purchase',
      [
        { walletType: walletType({ name: 'Support' }), amount: 0n },
        { walletType: walletType({ name: 'Repository' }), amount: 150n },
      ],
      [{ walletType: walletType({ name: 'Merchant' }), amount: 150n }],
    );

    expect(savedPostings).toHaveLength(2);
  });

  it('postReversal links back to the original journal entry when one exists', async () => {
    const service = new LedgerService();
    const { manager, savedEntries } = buildManager(SEEDED_ACCOUNTS, [
      { id: 'journal-original', transactionId: 'purchase-1' },
    ]);

    await service.postReversal(
      manager as any,
      'purchase-1',
      'reversal-1',
      'Refund',
      [{ walletType: walletType({ name: 'Merchant' }), amount: 500n }],
      [{ walletType: walletType(), amount: 500n }],
    );

    expect(savedEntries[0]).toMatchObject({
      transactionId: 'reversal-1',
      reversalOfId: 'journal-original',
    });
  });

  it('postReversal leaves reversalOfId null when no original entry is found', async () => {
    const service = new LedgerService();
    const { manager, savedEntries } = buildManager();

    await service.postReversal(
      manager as any,
      'purchase-1',
      'reversal-1',
      'Refund',
      [{ walletType: walletType({ name: 'Merchant' }), amount: 500n }],
      [{ walletType: walletType(), amount: 500n }],
    );

    expect(savedEntries[0]).toMatchObject({
      transactionId: 'reversal-1',
      reversalOfId: null,
    });
  });

  it('rejects an unbalanced set of legs', async () => {
    const service = new LedgerService();
    const { manager } = buildManager();

    await expect(
      service.postEntry(manager as any, {
        transactionId: 'tx-1',
        description: 'broken',
        legs: [
          {
            code: GlAccountCode.BANK_CASH,
            currencyId: USD_ID,
            direction: GlPostingDirection.DEBIT,
            amount: 100n,
          },
          {
            code: GlAccountCode.CUSTOMER_WALLETS,
            currencyId: USD_ID,
            direction: GlPostingDirection.CREDIT,
            amount: 99n,
          },
        ],
      }),
    ).rejects.toThrow(/Unbalanced/);
  });

  it('rejects an entry with fewer than two legs', async () => {
    const service = new LedgerService();
    const { manager } = buildManager();

    await expect(
      service.postEntry(manager as any, {
        transactionId: 'tx-1',
        description: 'broken',
        legs: [
          {
            code: GlAccountCode.BANK_CASH,
            currencyId: USD_ID,
            direction: GlPostingDirection.DEBIT,
            amount: 100n,
          },
        ],
      }),
    ).rejects.toThrow(/at least two legs/);
  });

  it('throws when an account has not been seeded for that currency', async () => {
    const service = new LedgerService();
    const { manager } = buildManager([]);

    await expect(
      service.getAccount(manager as any, GlAccountCode.BANK_CASH, USD_ID),
    ).rejects.toThrow(/No GL account seeded/);
  });

  it('caches accounts after the first lookup', async () => {
    const service = new LedgerService();
    const { manager } = buildManager();

    await service.getAccount(manager as any, GlAccountCode.BANK_CASH, USD_ID);
    await service.getAccount(manager as any, GlAccountCode.BANK_CASH, USD_ID);

    expect(manager.findOne).toHaveBeenCalledTimes(1);
  });
});
