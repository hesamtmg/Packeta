import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionType } from './entities/transaction.entity';

interface WalletTypeFixture {
  name: string;
  currency: { code: string };
  currencyId: string;
  allowNegativeBalance: boolean;
  creditLimit: string | null;
  allowWithdraw: boolean;
  allowP2pOut: boolean;
  allowP2pIn: boolean;
  allowPurchaseOut?: boolean;
  allowPurchaseIn?: boolean;
}

interface WalletFixture {
  id: string;
  userId?: string;
  balance: string;
  walletType: WalletTypeFixture;
  purchaseTimeoutSeconds?: number | null;
}

function buildService(options: {
  senderWallet: WalletFixture;
  recipientWallet?: WalletFixture | null;
  ipgOverrides?: Record<string, jest.Mock>;
}) {
  const { senderWallet, recipientWallet, ipgOverrides } = options;
  const lockCalls: string[] = [];

  const walletsById = new Map<string, WalletFixture>([
    [senderWallet.id, senderWallet],
    ...(recipientWallet
      ? [[recipientWallet.id, recipientWallet] as const]
      : []),
  ]);

  const walletsService = {
    getById: jest.fn(async (_userId: string, walletId: string) => {
      const wallet = walletsById.get(walletId);
      if (!wallet) throw new NotFoundException('Wallet not found');
      return wallet;
    }),
    getByIdUnscoped: jest.fn(async (walletId: string) => {
      const wallet = walletsById.get(walletId);
      if (!wallet) throw new NotFoundException('Wallet not found');
      return wallet;
    }),
    findEligibleP2pInWallet: jest.fn(
      async (_manager: unknown, _userId: string, currencyId: string) => {
        if (!recipientWallet) return null;
        return recipientWallet.walletType.currencyId === currencyId
          ? recipientWallet
          : null;
      },
    ),
    findEligiblePurchaseInWallet: jest.fn(
      async (_manager: unknown, _userId: string, currencyId: string) => {
        if (!recipientWallet) return null;
        return recipientWallet.walletType.currencyId === currencyId
          ? recipientWallet
          : null;
      },
    ),
    listForUser: jest.fn(),
    lockById: jest.fn(async (_manager: unknown, id: string) => {
      lockCalls.push(id);
      const wallet = walletsById.get(id)!;
      return wallet;
    }),
    isCounterpartyAllowed: jest.fn(() => true),
  };

  const idempotencyService = {
    claim: jest.fn().mockResolvedValue({ replay: false }),
    complete: jest.fn().mockResolvedValue(undefined),
  };

  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };

  const ipgClientService = {
    createPayment: jest.fn().mockResolvedValue({
      authority: 'auth-1',
      paymentUrl: 'http://ipg/pay/auth-1',
    }),
    verifyPayment: jest
      .fn()
      .mockResolvedValue({ success: true, refId: 'auth-1' }),
    ...ipgOverrides,
  };

  const configService = {
    get: jest.fn(() => 'http://localhost:5173'),
  };

  const manager = {
    findOne: jest.fn().mockResolvedValue({ id: 'recipient-user-id' }),
    update: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    save: jest.fn(async (data: any) => ({ ...data, id: data.id ?? 'tx-1' })),
    createQueryBuilder: jest.fn(() => {
      const builder: any = {
        setLock: () => builder,
        where: () => builder,
        andWhere: () => builder,
        getOne: async () => builder.__txn,
        __txn: undefined,
      };
      return builder;
    }),
  };

  const dataSource = {
    transaction: jest.fn(async (work: (manager: unknown) => Promise<unknown>) =>
      work(manager),
    ),
  };

  const settlementService = {
    validateChargeOverrides: jest.fn(),
    findForWallet: jest.fn().mockResolvedValue([]),
    findForTransactions: jest.fn().mockResolvedValue(new Map()),
    createForTransaction: jest.fn().mockResolvedValue(undefined),
    computeAmounts: jest.fn(),
  };

  const service = new TransactionsService(
    dataSource as any,
    walletsService as any,
    idempotencyService as any,
    loggingService as any,
    ipgClientService as any,
    configService as any,
    {} as any,
    settlementService as any,
    {} as any,
  );

  return { service, lockCalls, manager, ipgClientService };
}

function walletType(
  overrides: Partial<WalletTypeFixture> = {},
): WalletTypeFixture {
  return {
    name: 'Buy',
    currency: { code: 'USD' },
    currencyId: 'usd-currency-id',
    allowNegativeBalance: false,
    creditLimit: null,
    allowWithdraw: true,
    allowP2pOut: true,
    allowP2pIn: true,
    ...overrides,
  };
}

describe('TransactionsService.transfer', () => {
  it('locks wallets in ascending id order regardless of transfer direction', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-b',
      balance: '500',
      walletType: walletType(),
    };
    const recipientWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '0',
      walletType: walletType(),
    };
    const { service, lockCalls } = buildService({
      senderWallet,
      recipientWallet,
    });

    await service.transfer(
      'sender',
      senderWallet.id,
      'recipient@example.com',
      100,
      'idem-1',
    );

    expect(lockCalls).toEqual(['wallet-a', 'wallet-b']);
  });

  it('rejects a transfer that exceeds the sender balance', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '50',
      walletType: walletType(),
    };
    const recipientWallet: WalletFixture = {
      id: 'wallet-b',
      balance: '0',
      walletType: walletType(),
    };
    const { service } = buildService({ senderWallet, recipientWallet });

    await expect(
      service.transfer(
        'sender',
        senderWallet.id,
        'recipient@example.com',
        100,
        'idem-2',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a transfer from a wallet type that cannot send peer-to-peer', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '500',
      walletType: walletType({ name: 'Sell', allowP2pOut: false }),
    };
    const { service } = buildService({ senderWallet, recipientWallet: null });

    await expect(
      service.transfer(
        'sender',
        senderWallet.id,
        'recipient@example.com',
        100,
        'idem-3',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a transfer when the recipient has no eligible wallet', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '500',
      walletType: walletType(),
    };
    const { service } = buildService({ senderWallet, recipientWallet: null });

    await expect(
      service.transfer(
        'sender',
        senderWallet.id,
        'recipient@example.com',
        100,
        'idem-4',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a transfer when the recipient only has a wallet in a different currency', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '500',
      walletType: walletType({
        currency: { code: 'USD' },
        currencyId: 'usd-currency-id',
      }),
    };
    const recipientWallet: WalletFixture = {
      id: 'wallet-b',
      balance: '0',
      walletType: walletType({
        currency: { code: 'IRR' },
        currencyId: 'irr-currency-id',
      }),
    };
    const { service } = buildService({ senderWallet, recipientWallet });

    await expect(
      service.transfer(
        'sender',
        senderWallet.id,
        'recipient@example.com',
        100,
        'idem-4b',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows a credit wallet to go negative down to its credit limit', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '0',
      walletType: walletType({
        name: 'Credit',
        allowNegativeBalance: true,
        creditLimit: '1000',
        allowP2pOut: true,
      }),
    };
    const recipientWallet: WalletFixture = {
      id: 'wallet-b',
      balance: '0',
      walletType: walletType(),
    };
    const { service } = buildService({ senderWallet, recipientWallet });

    const result = await service.transfer(
      'sender',
      senderWallet.id,
      'recipient@example.com',
      1000,
      'idem-5',
    );

    expect(result.balance).toBe('-1000');
  });

  it('rejects a credit wallet transfer beyond its credit limit', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '0',
      walletType: walletType({
        name: 'Credit',
        allowNegativeBalance: true,
        creditLimit: '1000',
        allowP2pOut: true,
      }),
    };
    const recipientWallet: WalletFixture = {
      id: 'wallet-b',
      balance: '0',
      walletType: walletType(),
    };
    const { service } = buildService({ senderWallet, recipientWallet });

    await expect(
      service.transfer(
        'sender',
        senderWallet.id,
        'recipient@example.com',
        1001,
        'idem-6',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('TransactionsService.withdraw', () => {
  it('rejects a withdrawal from a wallet type that disallows it', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '500',
      walletType: walletType({ name: 'Gift', allowWithdraw: false }),
    };
    const { service } = buildService({ senderWallet });

    await expect(
      service.withdraw('sender', senderWallet.id, 100, 'idem-7'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows withdrawing a credit wallet into its credit limit', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '0',
      walletType: walletType({
        name: 'Credit',
        allowNegativeBalance: true,
        creditLimit: '500',
      }),
    };
    const { service } = buildService({ senderWallet });

    const result = await service.withdraw(
      'sender',
      senderWallet.id,
      500,
      'idem-8',
    );
    expect(result.balance).toBe('-500');
  });

  it('rejects withdrawing a credit wallet beyond its credit limit', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '0',
      walletType: walletType({
        name: 'Credit',
        allowNegativeBalance: true,
        creditLimit: '500',
      }),
    };
    const { service } = buildService({ senderWallet });

    await expect(
      service.withdraw('sender', senderWallet.id, 501, 'idem-9'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('TransactionsService.adjust', () => {
  it('credits a wallet and records the admin note', async () => {
    const wallet: WalletFixture = {
      id: 'wallet-a',
      balance: '100',
      walletType: walletType({ name: 'Gift', allowWithdraw: false }),
    };
    const { service } = buildService({ senderWallet: wallet });

    const result = await service.adjust(
      'admin-1',
      wallet.id,
      50,
      'Promo credit',
      'idem-10',
    );

    expect(result.balance).toBe('150');
    expect(result.toWalletId).toBe(wallet.id);
    expect(result.fromWalletId).toBeNull();
  });

  it('debits a wallet down to but not past its floor', async () => {
    const wallet: WalletFixture = {
      id: 'wallet-a',
      balance: '100',
      walletType: walletType({ name: 'Buy' }),
    };
    const { service } = buildService({ senderWallet: wallet });

    const result = await service.adjust(
      'admin-1',
      wallet.id,
      -100,
      'Correcting duplicate deposit',
      'idem-11',
    );
    expect(result.balance).toBe('0');
    expect(result.fromWalletId).toBe(wallet.id);
  });

  it('rejects a debit that would take the wallet past its floor', async () => {
    const wallet: WalletFixture = {
      id: 'wallet-a',
      balance: '100',
      walletType: walletType({ name: 'Buy' }),
    };
    const { service } = buildService({ senderWallet: wallet });

    await expect(
      service.adjust('admin-1', wallet.id, -101, 'Oops', 'idem-12'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('allows a debit past zero on a wallet with a credit limit', async () => {
    const wallet: WalletFixture = {
      id: 'wallet-a',
      balance: '0',
      walletType: walletType({
        name: 'Credit',
        allowNegativeBalance: true,
        creditLimit: '500',
      }),
    };
    const { service } = buildService({ senderWallet: wallet });

    const result = await service.adjust(
      'admin-1',
      wallet.id,
      -500,
      'Manual credit line correction',
      'idem-13',
    );
    expect(result.balance).toBe('-500');
  });

  it('rejects a zero-amount adjustment', async () => {
    const wallet: WalletFixture = {
      id: 'wallet-a',
      balance: '100',
      walletType: walletType({ name: 'Buy' }),
    };
    const { service } = buildService({ senderWallet: wallet });

    await expect(
      service.adjust('admin-1', wallet.id, 0, 'No-op', 'idem-14'),
    ).rejects.toThrow('amount must not be zero');
  });
});

describe('TransactionsService.initiatePurchase', () => {
  it('rejects a purchase from a wallet type that cannot make purchases', async () => {
    const customerWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '500',
      walletType: walletType({ name: 'Gift', allowPurchaseOut: false }),
    };
    const { service } = buildService({
      senderWallet: customerWallet,
      recipientWallet: null,
    });

    await expect(
      service.initiatePurchase(
        'customer',
        customerWallet.id,
        'merchant@example.com',
        100,
        'idem-p1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a purchase when the merchant has no eligible wallet', async () => {
    const customerWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '500',
      walletType: walletType({ allowPurchaseOut: true }),
    };
    const { service } = buildService({
      senderWallet: customerWallet,
      recipientWallet: null,
    });

    await expect(
      service.initiatePurchase(
        'customer',
        customerWallet.id,
        'merchant@example.com',
        100,
        'idem-p2',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a PENDING purchase with no balance change and stores the IPG authority', async () => {
    const customerWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '500',
      walletType: walletType({ allowPurchaseOut: true }),
    };
    const merchantWallet: WalletFixture = {
      id: 'wallet-b',
      balance: '0',
      purchaseTimeoutSeconds: 120,
      walletType: walletType({ name: 'Merchant', allowPurchaseIn: true }),
    };
    const { service, ipgClientService } = buildService({
      senderWallet: customerWallet,
      recipientWallet: merchantWallet,
    });

    const result = await service.initiatePurchase(
      'customer',
      customerWallet.id,
      'merchant@example.com',
      250,
      'idem-p3',
    );

    expect(result.redirectUrl).toBe('http://ipg/pay/auth-1');
    expect(ipgClientService.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '250', timeoutSeconds: 120 }),
    );
  });
});

function buildSweepService(options: {
  walletBalance: string;
  walletDefaults: any[];
  unsettledPurchases: any[];
  overridesByPurchase: Map<string, any[]>;
  computeAmountsImpl?: (rows: any[], amount: string) => any[];
}) {
  const wallet = { id: 'wallet-1', balance: options.walletBalance };
  const savedTransactions: any[] = [];
  const savedPurchases: any[] = [];
  const updatedBalances: string[] = [];

  const walletsService = { lockById: jest.fn(async () => wallet) };

  const manager = {
    update: jest.fn(async (_entity: unknown, _id: string, patch: any) => {
      if (patch.balance !== undefined) updatedBalances.push(patch.balance);
    }),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    save: jest.fn(async (data: any) => {
      if (data.type === TransactionType.WITHDRAW) {
        savedTransactions.push(data);
      } else {
        savedPurchases.push(data);
      }
      return data;
    }),
    createQueryBuilder: jest.fn(() => {
      const builder: any = {
        setLock: () => builder,
        where: () => builder,
        andWhere: () => builder,
        getMany: async () => options.unsettledPurchases,
      };
      return builder;
    }),
  };

  const dataSource = {
    transaction: jest.fn(async (work: (manager: unknown) => Promise<unknown>) =>
      work(manager),
    ),
  };

  const settlementService = {
    findForWallet: jest.fn().mockResolvedValue(options.walletDefaults),
    findForTransactions: jest
      .fn()
      .mockResolvedValue(options.overridesByPurchase),
    computeAmounts: jest.fn(
      options.computeAmountsImpl ??
        ((rows: any[], amount: string) => [
          { iban: rows[0]?.iban ?? null, label: null, amount: BigInt(amount) },
        ]),
    ),
  };

  const service = new TransactionsService(
    dataSource as any,
    walletsService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    settlementService as any,
    {} as any,
  );

  return { service, savedTransactions, savedPurchases, updatedBalances };
}

describe('TransactionsService.sweepAutoWithdraw', () => {
  it('falls back to a single full-balance WITHDRAW when no settlement split is configured (legacy behavior)', async () => {
    const { service, savedTransactions, updatedBalances } = buildSweepService({
      walletBalance: '5000',
      walletDefaults: [],
      unsettledPurchases: [],
      overridesByPurchase: new Map(),
    });

    await service.sweepAutoWithdraw('wallet-1');

    expect(savedTransactions).toHaveLength(1);
    expect(savedTransactions[0]).toMatchObject({
      type: TransactionType.WITHDRAW,
      fromWalletId: 'wallet-1',
      amount: '5000',
    });
    expect(updatedBalances).toEqual(['0']);
  });

  it('splits each unsettled purchase individually — its own override if it has one, else the wallet default', async () => {
    const purchaseWithOverride = {
      id: 'purchase-1',
      amount: '1000',
      settledAt: null,
    };
    const purchaseWithDefault = {
      id: 'purchase-2',
      amount: '2000',
      settledAt: null,
    };
    const overrideRows = [{ iban: 'override-iban', label: null }];
    const defaultRows = [{ iban: 'default-iban', label: null }];

    const { service, savedTransactions, savedPurchases, updatedBalances } =
      buildSweepService({
        walletBalance: '3000',
        walletDefaults: defaultRows,
        unsettledPurchases: [purchaseWithOverride, purchaseWithDefault],
        overridesByPurchase: new Map([['purchase-1', overrideRows]]),
      });

    await service.sweepAutoWithdraw('wallet-1');

    expect(savedTransactions).toHaveLength(2);
    expect(savedTransactions[0]).toMatchObject({
      destinationIban: 'override-iban',
      relatedTransactionId: 'purchase-1',
      amount: '1000',
    });
    expect(savedTransactions[1]).toMatchObject({
      destinationIban: 'default-iban',
      relatedTransactionId: 'purchase-2',
      amount: '2000',
    });
    expect(savedPurchases.every((p) => p.settledAt instanceof Date)).toBe(true);
    expect(updatedBalances).toEqual(['0']);
  });

  it('falls back to a single plain WITHDRAW for a purchase with neither override nor wallet default, while split mode is active for the wallet', async () => {
    const purchaseNoConfig = {
      id: 'purchase-3',
      amount: '500',
      settledAt: null,
    };
    const { service, savedTransactions } = buildSweepService({
      walletBalance: '500',
      walletDefaults: [],
      unsettledPurchases: [purchaseNoConfig],
      // Split mode is active because some other purchase on this wallet has
      // an override — purchase-3 itself still has no split configured.
      overridesByPurchase: new Map([
        ['other-purchase', [{ iban: 'x', label: null }]],
      ]),
    });

    await service.sweepAutoWithdraw('wallet-1');

    expect(savedTransactions).toHaveLength(1);
    expect(savedTransactions[0]).toMatchObject({
      amount: '500',
      relatedTransactionId: 'purchase-3',
      destinationIban: null,
    });
  });
});
