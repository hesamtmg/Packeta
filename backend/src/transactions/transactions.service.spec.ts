import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionType } from './entities/transaction.entity';
import { SettlementRailType } from '../rail-settlements/entities/rail-settlement.entity';

interface WalletTypeFixture {
  code?: string;
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
  depositable?: boolean;
  unblockFee?: string | null;
}

interface WalletFixture {
  id: string;
  userId?: string;
  balance: string;
  walletType: WalletTypeFixture;
  purchaseTimeoutSeconds?: number | null;
  repositoryWalletId?: string | null;
  blockedAt?: Date | null;
  closedAt?: Date | null;
  virtualAmount?: string | null;
}

function buildService(options: {
  senderWallet: WalletFixture;
  recipientWallet?: WalletFixture | null;
  repositoryWallet?: WalletFixture | null;
  ipgOverrides?: Record<string, jest.Mock>;
  installmentsService?: Record<string, jest.Mock>;
}) {
  const {
    senderWallet,
    recipientWallet,
    repositoryWallet,
    ipgOverrides,
    installmentsService,
  } = options;
  const lockCalls: string[] = [];

  const walletsById = new Map<string, WalletFixture>([
    [senderWallet.id, senderWallet],
    ...(recipientWallet
      ? [[recipientWallet.id, recipientWallet] as const]
      : []),
    ...(repositoryWallet
      ? [[repositoryWallet.id, repositoryWallet] as const]
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
    assertWithinTransactionLimits: jest.fn(),
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

  const zarinpalClientService = {
    createPayment: jest.fn().mockResolvedValue({
      authority: 'zarinpal-auth-1',
      paymentUrl: 'https://sandbox.zarinpal.com/pg/StartPay/zarinpal-auth-1',
    }),
    verifyPayment: jest
      .fn()
      .mockResolvedValue({ success: true, refId: 'zarinpal-ref-1' }),
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

  const railSettlementsService = {
    createForSweep: jest.fn(),
  };

  const service = new TransactionsService(
    dataSource as any,
    walletsService as any,
    idempotencyService as any,
    loggingService as any,
    ipgClientService as any,
    zarinpalClientService as any,
    configService as any,
    {} as any,
    settlementService as any,
    (installmentsService ?? {}) as any,
    railSettlementsService as any,
    {} as any,
  );

  return {
    service,
    lockCalls,
    manager,
    ipgClientService,
    zarinpalClientService,
  };
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
    depositable: true,
    ...overrides,
  };
}

describe('TransactionsService.deposit', () => {
  it('rejects a deposit into a wallet whose type has deposits disabled', async () => {
    const wallet: WalletFixture = {
      id: 'wallet-1',
      balance: '0',
      walletType: walletType({ depositable: false }),
    };
    const { service } = buildService({ senderWallet: wallet });

    await expect(
      service.deposit('user-1', 'wallet-1', 100, 'idem-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('initiates a walletless ZarinPal payment for a wallet whose type accepts deposits', async () => {
    const wallet: WalletFixture = {
      id: 'wallet-1',
      balance: '0',
      walletType: walletType({ depositable: true }),
    };
    const { service, manager, zarinpalClientService, ipgClientService } =
      buildService({ senderWallet: wallet });

    const result = await service.deposit('user-1', 'wallet-1', 250, 'idem-2');

    expect(result.redirectUrl).toBe(
      'https://sandbox.zarinpal.com/pg/StartPay/zarinpal-auth-1',
    );
    expect(zarinpalClientService.createPayment).toHaveBeenCalled();
    expect(ipgClientService.createPayment).not.toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TransactionType.DEPOSIT,
        fromWalletId: null,
        toWalletId: 'wallet-1',
        amount: '250',
      }),
    );
  });
});

describe('TransactionsService.initiateCharge merchant access controls', () => {
  function buildChargeService(merchantWallet: WalletFixture) {
    const { service, ...rest } = buildService({
      senderWallet: merchantWallet,
      recipientWallet: merchantWallet,
    });
    // initiateCharge's auto-pick path resolves currency via
    // currenciesService.findByCode, not the walletsService/manager mocks
    // buildService wires up for transfer/purchase — inject a minimal stub.
    (service as any).currenciesService = {
      findByCode: jest.fn(async () => ({
        id: merchantWallet.walletType.currencyId,
        code: merchantWallet.walletType.currency.code,
      })),
    };
    // initiateCharge looks the merchant up for displayIdentity() — the
    // shared manager mock's default findOne stub has no email, which
    // displayIdentity requires.
    rest.manager.findOne = jest.fn().mockResolvedValue({
      id: 'merchant-1',
      email: 'merchant@example.com',
      phoneNumber: null,
    });
    return { service, ...rest };
  }

  it('rejects a self-service charge from an IP outside the configured allowlist', async () => {
    const merchantWallet: WalletFixture = {
      id: 'wallet-merchant',
      userId: 'merchant-1',
      balance: '0',
      walletType: walletType({ allowPurchaseIn: true }),
      allowedIps: ['203.0.113.4'],
    } as any;
    const { service } = buildChargeService(merchantWallet);

    await expect(
      service.initiateCharge(
        'merchant-1',
        500,
        'USD',
        'idem-charge-1',
        undefined,
        undefined,
        undefined,
        { ip: '198.51.100.9' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a self-service charge from an IP in the configured allowlist', async () => {
    const merchantWallet: WalletFixture = {
      id: 'wallet-merchant',
      userId: 'merchant-1',
      balance: '0',
      walletType: walletType({ allowPurchaseIn: true }),
      allowedIps: ['203.0.113.4'],
    } as any;
    const { service } = buildChargeService(merchantWallet);

    const result = await service.initiateCharge(
      'merchant-1',
      500,
      'USD',
      'idem-charge-2',
      undefined,
      undefined,
      undefined,
      { ip: '203.0.113.4' },
    );

    expect(result.redirectUrl).toBe('http://ipg/pay/auth-1');
  });

  it('rejects a self-service charge whose Origin does not match the registered store site', async () => {
    const merchantWallet: WalletFixture = {
      id: 'wallet-merchant',
      userId: 'merchant-1',
      balance: '0',
      walletType: walletType({ allowPurchaseIn: true }),
      storeSite: 'https://my-real-store.example',
    } as any;
    const { service } = buildChargeService(merchantWallet);

    await expect(
      service.initiateCharge(
        'merchant-1',
        500,
        'USD',
        'idem-charge-3',
        undefined,
        undefined,
        undefined,
        { origin: 'https://evil.example' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a self-service charge with no Origin/Referer header even when storeSite is configured', async () => {
    const merchantWallet: WalletFixture = {
      id: 'wallet-merchant',
      userId: 'merchant-1',
      balance: '0',
      walletType: walletType({ allowPurchaseIn: true }),
      storeSite: 'https://my-real-store.example',
    } as any;
    const { service } = buildChargeService(merchantWallet);

    const result = await service.initiateCharge(
      'merchant-1',
      500,
      'USD',
      'idem-charge-4',
    );

    expect(result.redirectUrl).toBe('http://ipg/pay/auth-1');
  });
});

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

  it('also debits the linked repository when withdrawing from a repository-backed credit wallet', async () => {
    const repositoryWallet: WalletFixture = {
      id: 'repo-1',
      balance: '5000',
      walletType: walletType({ name: 'Repository' }),
    };
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '1000',
      walletType: walletType({ name: 'Credit' }),
      repositoryWalletId: 'repo-1',
    };
    const { service, manager } = buildService({
      senderWallet,
      repositoryWallet,
    });

    const result = await service.withdraw(
      'sender',
      senderWallet.id,
      300,
      'idem-repo-1',
    );

    expect(result.balance).toBe('700');
    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'repo-1', {
      balance: '4700',
    });
  });

  it('rejects a withdrawal when the linked repository lacks enough real balance to fund it', async () => {
    const repositoryWallet: WalletFixture = {
      id: 'repo-1',
      balance: '100',
      walletType: walletType({ name: 'Repository' }),
    };
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '1000',
      walletType: walletType({ name: 'Credit' }),
      repositoryWalletId: 'repo-1',
    };
    const { service } = buildService({ senderWallet, repositoryWallet });

    await expect(
      service.withdraw('sender', senderWallet.id, 300, 'idem-repo-2'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a withdrawal from a wallet blocked by an overdue installment', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '500',
      walletType: walletType({ name: 'Credit' }),
      blockedAt: new Date(),
    };
    const { service } = buildService({ senderWallet });

    await expect(
      service.withdraw('sender', senderWallet.id, 100, 'idem-blocked-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
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
  railType?: SettlementRailType;
}) {
  const wallet = {
    id: 'wallet-1',
    balance: options.walletBalance,
    railType: options.railType ?? null,
  };
  const savedTransactions: any[] = [];
  const savedPurchases: any[] = [];
  const updatedBalances: string[] = [];
  const railSettlementLinks: any[] = [];
  let idCounter = 0;

  const walletsService = { lockById: jest.fn(async () => wallet) };

  const manager = {
    update: jest.fn(async (_entity: unknown, _id: string, patch: any) => {
      if (patch.balance !== undefined) updatedBalances.push(patch.balance);
      if (patch.railSettlementId !== undefined) {
        railSettlementLinks.push({ id: _id, ...patch });
      }
    }),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    save: jest.fn(async (data: any) => {
      if (data.type === TransactionType.WITHDRAW) {
        data.id = data.id ?? `withdraw-${++idCounter}`;
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

  let railSettlementCounter = 0;
  const railSettlementsCreated: any[] = [];
  const railSettlementsService = {
    createForSweep: jest.fn(async (_manager: unknown, input: any) => {
      railSettlementsCreated.push(input);
      return { id: `rail-settlement-${++railSettlementCounter}`, ...input };
    }),
  };

  const service = new TransactionsService(
    dataSource as any,
    walletsService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    settlementService as any,
    {} as any,
    railSettlementsService as any,
    {} as any,
  );

  return {
    service,
    savedTransactions,
    savedPurchases,
    updatedBalances,
    railSettlementsCreated,
    railSettlementLinks,
  };
}

describe('TransactionsService.verifyPurchase', () => {
  it("draws down a CREDIT wallet's virtual balance and logs a TRANSFER when paying a merchant", async () => {
    const creditWallet: WalletFixture = {
      id: 'credit-wallet-1',
      balance: '1000',
      virtualAmount: '400',
      walletType: walletType({ code: 'CREDIT', allowPurchaseOut: true }),
    };
    const merchantWallet: WalletFixture = {
      id: 'merchant-wallet-1',
      balance: '0',
      walletType: walletType({ allowPurchaseIn: true }),
    };
    const { service, manager } = buildService({
      senderWallet: creditWallet,
      recipientWallet: merchantWallet,
    });

    const pendingPurchase = {
      id: 'purchase-tx-1',
      type: TransactionType.PURCHASE,
      status: 'PENDING',
      fromWalletId: creditWallet.id,
      toWalletId: merchantWallet.id,
      amount: '150',
      installmentId: null,
      expiresAt: null,
    };
    manager.createQueryBuilder = jest.fn(() => {
      const builder: any = {
        setLock: () => builder,
        where: () => builder,
        andWhere: () => builder,
        getOne: async () => pendingPurchase,
      };
      return builder;
    });

    const result = await service.verifyPurchase('purchase-tx-1');

    expect(result.status).toBe('COMPLETED');
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      creditWallet.id,
      { virtualAmount: '250' },
    );
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: TransactionType.TRANSFER,
        fromWalletId: creditWallet.id,
        toWalletId: creditWallet.id,
        amount: '150',
        idempotencyKey: 'credit-draw:purchase-tx-1',
      }),
    );
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      creditWallet.id,
      { balance: '850' },
    );
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      merchantWallet.id,
      { balance: '150' },
    );
  });

  it('does not draw virtual balance for a non-CREDIT purchase', async () => {
    const buyWallet: WalletFixture = {
      id: 'buy-wallet-1',
      balance: '1000',
      walletType: walletType({ code: 'BUY', allowPurchaseOut: true }),
    };
    const merchantWallet: WalletFixture = {
      id: 'merchant-wallet-2',
      balance: '0',
      walletType: walletType({ allowPurchaseIn: true }),
    };
    const { service, manager } = buildService({
      senderWallet: buyWallet,
      recipientWallet: merchantWallet,
    });

    const pendingPurchase = {
      id: 'purchase-tx-2',
      type: TransactionType.PURCHASE,
      status: 'PENDING',
      fromWalletId: buyWallet.id,
      toWalletId: merchantWallet.id,
      amount: '150',
      installmentId: null,
      expiresAt: null,
    };
    manager.createQueryBuilder = jest.fn(() => {
      const builder: any = {
        setLock: () => builder,
        where: () => builder,
        andWhere: () => builder,
        getOne: async () => pendingPurchase,
      };
      return builder;
    });

    await service.verifyPurchase('purchase-tx-2');

    expect(manager.update).not.toHaveBeenCalledWith(
      expect.anything(),
      buyWallet.id,
      expect.objectContaining({ virtualAmount: expect.anything() }),
    );
    expect(manager.create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: TransactionType.TRANSFER }),
    );
  });
});

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

describe('TransactionsService.sweepAutoWithdraw rail-aware behavior', () => {
  it('does not create a RailSettlement for a wallet with no railType configured', async () => {
    const { service, railSettlementsCreated } = buildSweepService({
      walletBalance: '5000',
      walletDefaults: [],
      unsettledPurchases: [],
      overridesByPurchase: new Map(),
    });

    await service.sweepAutoWithdraw('wallet-1');

    expect(railSettlementsCreated).toHaveLength(0);
  });

  it('records a RailSettlement and links it back to the WITHDRAW for the legacy (no-split) path', async () => {
    const {
      service,
      savedTransactions,
      railSettlementsCreated,
      railSettlementLinks,
    } = buildSweepService({
      walletBalance: '5000',
      walletDefaults: [],
      unsettledPurchases: [],
      overridesByPurchase: new Map(),
      railType: SettlementRailType.SATNA,
    });

    await service.sweepAutoWithdraw('wallet-1');

    expect(savedTransactions).toHaveLength(1);
    expect(railSettlementsCreated).toHaveLength(1);
    expect(railSettlementsCreated[0]).toMatchObject({
      walletId: 'wallet-1',
      railType: SettlementRailType.SATNA,
      amount: '5000',
      transactionId: savedTransactions[0].id,
    });
    expect(railSettlementLinks).toHaveLength(1);
    expect(railSettlementLinks[0]).toMatchObject({
      id: savedTransactions[0].id,
      railSettlementId: 'rail-settlement-1',
    });
  });

  it('records one RailSettlement per generated WITHDRAW slice in split-settlement mode', async () => {
    const purchase = { id: 'purchase-1', amount: '1000', settledAt: null };
    const { service, savedTransactions, railSettlementsCreated } =
      buildSweepService({
        walletBalance: '1000',
        walletDefaults: [{ iban: 'default-iban', label: null }],
        unsettledPurchases: [purchase],
        overridesByPurchase: new Map(),
        railType: SettlementRailType.PAYA,
      });

    await service.sweepAutoWithdraw('wallet-1');

    expect(savedTransactions).toHaveLength(1);
    expect(railSettlementsCreated).toHaveLength(1);
    expect(railSettlementsCreated[0]).toMatchObject({
      railType: SettlementRailType.PAYA,
      destinationIban: 'default-iban',
      amount: '1000',
    });
  });
});

describe('TransactionsService.payInstallment', () => {
  const repositoryWallet: WalletFixture = {
    id: 'repo-1',
    balance: '1000',
    walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
  };

  const fromWallet: WalletFixture = {
    id: 'payer-1',
    userId: 'personnel-1',
    balance: '5000',
    walletType: walletType({ name: 'Buy', allowPurchaseOut: true }),
  };

  function baseInstallment(overrides: Record<string, any> = {}) {
    return {
      id: 'installment-1',
      amount: '400',
      status: 'PENDING',
      wallet: {
        id: 'credit-1',
        userId: 'personnel-1',
        repositoryWalletId: 'repo-1',
        blockedAt: null,
        walletType: { unblockFee: '50' },
      },
      ...overrides,
    };
  }

  function buildPayService(installment: any) {
    const installmentsService = {
      getByIdForUser: jest.fn(async () => installment),
      markPaid: jest.fn(async () => undefined),
    };
    return buildService({
      senderWallet: fromWallet,
      repositoryWallet,
      installmentsService: installmentsService as any,
    });
  }

  it('rejects paying an already-PAID installment', async () => {
    const { service } = buildPayService(baseInstallment({ status: 'PAID' }));

    await expect(
      service.payInstallment('personnel-1', 'installment-1', 'idem-inst-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects when the credit wallet has no linked repository', async () => {
    const { service } = buildPayService(
      baseInstallment({
        wallet: {
          id: 'credit-1',
          userId: 'personnel-1',
          repositoryWalletId: null,
          blockedAt: null,
          walletType: { unblockFee: '50' },
        },
      }),
    );

    await expect(
      service.payInstallment('personnel-1', 'installment-1', 'idem-inst-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the repository does not accept purchases', async () => {
    const closedRepository: WalletFixture = {
      ...repositoryWallet,
      walletType: walletType({ name: 'Repository', allowPurchaseIn: false }),
    };
    const installmentsService = {
      getByIdForUser: jest.fn(async () => baseInstallment()),
      markPaid: jest.fn(async () => undefined),
    };
    const { service } = buildService({
      senderWallet: fromWallet,
      repositoryWallet: closedRepository,
      installmentsService: installmentsService as any,
    });

    await expect(
      service.payInstallment('personnel-1', 'installment-1', 'idem-inst-3'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('initiates a walletless repayment for exactly the installment amount when not blocked', async () => {
    const { service, manager } = buildPayService(baseInstallment());

    const result = await service.payInstallment(
      'personnel-1',
      'installment-1',
      'idem-inst-5',
    );

    expect(result.redirectUrl).toBe('http://ipg/pay/auth-1');
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        toWalletId: 'repo-1',
        fromWalletId: null,
        amount: '400',
        installmentId: 'installment-1',
      }),
    );
  });

  it('folds the unblockFee into the charge when the credit wallet is blocked', async () => {
    const { service, manager } = buildPayService(
      baseInstallment({
        wallet: {
          id: 'credit-1',
          userId: 'personnel-1',
          repositoryWalletId: 'repo-1',
          blockedAt: new Date(),
          walletType: { unblockFee: '50' },
        },
      }),
    );

    await service.payInstallment('personnel-1', 'installment-1', 'idem-inst-6');

    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '450' }),
    );
  });
});
