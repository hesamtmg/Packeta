import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { TransactionType } from './entities/transaction.entity';
import {
  RailSettlementStatus,
  SettlementRailType,
} from '../rail-settlements/entities/rail-settlement.entity';

// Minimal stand-in for nestjs-i18n's I18nService: resolves against the real
// English translation files (so message-dependent assertions, e.g. the
// "amount must not be zero" check below, still see real copy) without
// pulling in the whole I18nModule/request-context machinery for a plain
// `new TransactionsService(...)` unit test.
const i18nNamespaces = ['common', 'transactions'];
const i18nDict: Record<string, Record<string, string>> = {};
for (const ns of i18nNamespaces) {
  i18nDict[ns] = require(`../i18n/en/${ns}.json`);
}
const i18nStub = {
  t: (key: string, options?: { args?: Record<string, string> }) => {
    const [ns, prop] = key.split('.');
    let text = i18nDict[ns]?.[prop] ?? key;
    if (options?.args) {
      for (const [argKey, value] of Object.entries(options.args)) {
        text = text.replace(new RegExp(`\\{${argKey}\\}`, 'g'), value);
      }
    }
    return text;
  },
};

// GL posting itself is verified separately (see ledger.service.spec.ts) —
// what these unit tests need is a stand-in that both (a) records call args
// for assertions and (b) actually behaves like a ledger for
// getWalletBalance, since there's no wallets.balance column to read
// anymore. Seeded from each wallet fixture's own (otherwise now-dead)
// `balance` field and then updated by whichever posting method actually
// runs, mirroring LedgerService's own delta rules (CREDIT/funds-in moves a
// balance up, DEBIT/funds-out moves it down) — this matters whenever a
// test's scenario reads a wallet's balance mid-flow, after an earlier
// posting in the same call already moved it (e.g. a support wallet credited
// by one posting and immediately spent by the next).
function buildLedgerServiceStub(wallets: Array<{ id: string; balance: string }>) {
  const balances = new Map<string, bigint>(
    wallets.map((w) => [w.id, BigInt(w.balance)]),
  );
  const applyDelta = (wallet: { id: string }, delta: bigint) => {
    balances.set(wallet.id, (balances.get(wallet.id) ?? 0n) + delta);
  };
  const applyLegs = (
    debits: Array<{ wallet: { id: string }; amount: bigint }>,
    credits: Array<{ wallet: { id: string }; amount: bigint }>,
  ) => {
    for (const d of debits) applyDelta(d.wallet, -d.amount);
    for (const c of credits) applyDelta(c.wallet, c.amount);
  };

  return {
    postCashMovement: jest.fn(
      async (
        _manager: unknown,
        _transactionId: string,
        _description: string,
        wallet: { id: string },
        delta: bigint,
      ) => {
        applyDelta(wallet, delta);
      },
    ),
    postCashInMultiLeg: jest.fn(
      async (
        _manager: unknown,
        _transactionId: string,
        _description: string,
        _cashAccountCode: unknown,
        _currencyId: string,
        _totalAmount: bigint,
        walletCredits: Array<{ wallet: { id: string }; amount: bigint }>,
      ) => {
        for (const credit of walletCredits) applyDelta(credit.wallet, credit.amount);
      },
    ),
    postWalletToWallet: jest.fn(
      async (
        _manager: unknown,
        _transactionId: string,
        _description: string,
        fromWallet: { id: string },
        toWallet: { id: string },
        amount: bigint,
      ) => {
        applyDelta(fromWallet, -amount);
        applyDelta(toWallet, amount);
      },
    ),
    postAdjustment: jest.fn(
      async (
        _manager: unknown,
        _transactionId: string,
        _description: string,
        wallet: { id: string },
        delta: bigint,
      ) => {
        applyDelta(wallet, delta);
      },
    ),
    postMultiLeg: jest.fn(
      async (
        _manager: unknown,
        _transactionId: string,
        _description: string,
        debits: Array<{ wallet: { id: string }; amount: bigint }>,
        credits: Array<{ wallet: { id: string }; amount: bigint }>,
      ) => {
        applyLegs(debits, credits);
      },
    ),
    postReversal: jest.fn(
      async (
        _manager: unknown,
        _originalTransactionId: string,
        _reversalTransactionId: string,
        _description: string,
        debits: Array<{ wallet: { id: string }; amount: bigint }>,
        credits: Array<{ wallet: { id: string }; amount: bigint }>,
      ) => {
        applyLegs(debits, credits);
      },
    ),
    postRepositoryAllocationMirror: jest.fn(
      async (
        _manager: unknown,
        _transactionId: string,
        _description: string,
        wallet: { id: string },
        delta: bigint,
      ) => {
        if (delta === 0n) return null;
        applyDelta(wallet, delta);
        return undefined;
      },
    ),
    postEntry: jest.fn().mockResolvedValue(undefined),
    getWalletBalance: jest.fn(async (_manager: unknown, walletId: string) =>
      balances.get(walletId) ?? 0n,
    ),
    getWalletBalances: jest.fn(
      async (_manager: unknown, walletIds: string[]) => {
        const result = new Map<string, bigint>();
        for (const id of walletIds) result.set(id, balances.get(id) ?? 0n);
        return result;
      },
    ),
  };
}

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
  supportsAutoWithdraw?: boolean;
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
  callbackUrl?: string | null;
}

function buildService(options: {
  senderWallet: WalletFixture;
  recipientWallet?: WalletFixture | null;
  repositoryWallet?: WalletFixture | null;
  supportWallet?: WalletFixture | null;
  ipgOverrides?: Record<string, jest.Mock>;
  installmentsService?: Record<string, jest.Mock>;
  railSettlementStatus?: RailSettlementStatus;
}) {
  const {
    senderWallet,
    recipientWallet,
    repositoryWallet,
    supportWallet,
    ipgOverrides,
    installmentsService,
    railSettlementStatus,
  } = options;
  const lockCalls: string[] = [];

  const walletsById = new Map<string, WalletFixture>([
    [senderWallet.id, senderWallet],
    ...(supportWallet ? [[supportWallet.id, supportWallet] as const] : []),
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
    findOrCreateSupportWallet: jest.fn(async () => {
      if (!supportWallet) throw new NotFoundException('No support wallet');
      return supportWallet;
    }),
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
    createForSweep: jest.fn().mockResolvedValue({
      id: 'rail-settlement-1',
      status: railSettlementStatus ?? RailSettlementStatus.COMPLETED,
    }),
  };

  const ledgerService = buildLedgerServiceStub(Array.from(walletsById.values()));

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
    ledgerService as any,
    {} as any,
    i18nStub as any,
  );

  return {
    service,
    lockCalls,
    manager,
    ipgClientService,
    zarinpalClientService,
    railSettlementsService,
    walletsService,
    ledgerService,
  };
}

// Mirrors InstallmentsService.computeRepaymentSplit for test fixtures that
// mock installmentsService directly instead of using the real service.
function computeRepaymentSplitFixture(
  installments: {
    amount: string;
    principalAmount: string;
    feeAmount: string;
  }[],
) {
  let principal = 0n;
  let fee = 0n;
  let total = 0n;
  for (const i of installments) {
    principal += BigInt(i.principalAmount);
    fee += BigInt(i.feeAmount);
    total += BigInt(i.amount);
  }
  return { principal, fee, penalty: total - principal - fee };
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

  it('posts a wallet-to-wallet GL entry with no cash leg', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-b',
      balance: '500',
      walletType: walletType(),
    };
    const recipientWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '0',
      walletType: walletType({ name: 'Sell', allowP2pOut: false }),
    };
    const { service, manager, ledgerService } = buildService({
      senderWallet,
      recipientWallet,
    });

    const result = await service.transfer(
      'sender',
      senderWallet.id,
      'recipient@example.com',
      100,
      'idem-gl-transfer-1',
    );

    expect(ledgerService.postWalletToWallet).toHaveBeenCalledWith(
      manager,
      result.transactionId,
      expect.any(String),
      { id: senderWallet.id, walletType: senderWallet.walletType },
      { id: recipientWallet.id, walletType: recipientWallet.walletType },
      100n,
    );
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
      service.withdraw(
        'sender',
        senderWallet.id,
        100,
        SettlementRailType.POL_PAY,
        'IR000000000000000000000001',
        'idem-7',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a manual withdrawal from a merchant-style (auto-withdraw) wallet type', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '500',
      walletType: walletType({ name: 'Merchant', supportsAutoWithdraw: true }),
    };
    const { service } = buildService({ senderWallet });

    await expect(
      service.withdraw(
        'sender',
        senderWallet.id,
        100,
        SettlementRailType.POL_PAY,
        'IR000000000000000000000001',
        'idem-7b',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows withdrawing a credit wallet into its credit limit and records the chosen rail', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '0',
      walletType: walletType({
        name: 'Credit',
        allowNegativeBalance: true,
        creditLimit: '500',
      }),
    };
    const { service, manager, railSettlementsService } = buildService({
      senderWallet,
    });

    const result = await service.withdraw(
      'sender',
      senderWallet.id,
      500,
      SettlementRailType.PAYA,
      'IR000000000000000000000001',
      'idem-8',
    );
    expect(result.balance).toBe('-500');
    expect(railSettlementsService.createForSweep).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        walletId: senderWallet.id,
        railType: 'PAYA',
        amount: '500',
      }),
    );
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      result.transactionId,
      { railSettlementId: 'rail-settlement-1' },
    );
  });

  it('posts a WITHDRAW to bank cash when the rail settlement completes', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '1000',
      walletType: walletType({ name: 'Buy' }),
    };
    const { service, manager, ledgerService } = buildService({
      senderWallet,
      railSettlementStatus: RailSettlementStatus.COMPLETED,
    });

    const result = await service.withdraw(
      'sender',
      senderWallet.id,
      300,
      SettlementRailType.POL_PAY,
      'IR000000000000000000000001',
      'idem-gl-withdraw-1',
    );

    expect(ledgerService.postCashMovement).toHaveBeenCalledWith(
      manager,
      result.transactionId,
      expect.any(String),
      { id: senderWallet.id, walletType: senderWallet.walletType },
      -300n,
      'BANK_CASH',
    );
  });

  it('parks a WITHDRAW in settlement clearing (not bank cash) when the rail settlement fails', async () => {
    const senderWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '1000',
      walletType: walletType({ name: 'Buy' }),
    };
    const { service, manager, ledgerService } = buildService({
      senderWallet,
      railSettlementStatus: RailSettlementStatus.FAILED,
    });

    const result = await service.withdraw(
      'sender',
      senderWallet.id,
      300,
      SettlementRailType.POL_PAY,
      'IR000000000000000000000001',
      'idem-gl-withdraw-2',
    );

    expect(ledgerService.postCashMovement).toHaveBeenCalledWith(
      manager,
      result.transactionId,
      expect.any(String),
      { id: senderWallet.id, walletType: senderWallet.walletType },
      -300n,
      'SETTLEMENT_CLEARING',
    );
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
      service.withdraw(
        'sender',
        senderWallet.id,
        501,
        SettlementRailType.POL_PAY,
        'IR000000000000000000000001',
        'idem-9',
      ),
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
    const { service, manager, ledgerService } = buildService({
      senderWallet,
      repositoryWallet,
    });

    const result = await service.withdraw(
      'sender',
      senderWallet.id,
      300,
      SettlementRailType.POL_PAY,
      'IR000000000000000000000001',
      'idem-repo-1',
    );

    expect(result.balance).toBe('700');
    // The real cash movement redirects to the repository (the actual money
    // funding this withdrawal), not the credit wallet's own type.
    expect(ledgerService.postCashMovement).toHaveBeenCalledWith(
      manager,
      result.transactionId,
      expect.any(String),
      { id: repositoryWallet.id, walletType: repositoryWallet.walletType },
      -300n,
      expect.any(String),
    );
    // The credit wallet's own balance also mirrors the movement, offset
    // through REPOSITORY_ALLOCATIONS.
    expect(ledgerService.postRepositoryAllocationMirror).toHaveBeenCalledWith(
      manager,
      result.transactionId,
      expect.any(String),
      { id: senderWallet.id, walletType: senderWallet.walletType },
      -300n,
    );
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
      service.withdraw(
        'sender',
        senderWallet.id,
        300,
        SettlementRailType.POL_PAY,
        'IR000000000000000000000001',
        'idem-repo-2',
      ),
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
      service.withdraw(
        'sender',
        senderWallet.id,
        100,
        SettlementRailType.POL_PAY,
        'IR000000000000000000000001',
        'idem-blocked-1',
      ),
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
    const { service, manager, ledgerService } = buildService({
      senderWallet: wallet,
    });

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
    expect(ledgerService.postAdjustment).toHaveBeenCalledWith(
      manager,
      result.transactionId,
      'Promo credit',
      { id: wallet.id, walletType: wallet.walletType },
      50n,
    );
  });

  it('debits a wallet down to but not past its floor', async () => {
    const wallet: WalletFixture = {
      id: 'wallet-a',
      balance: '100',
      walletType: walletType({ name: 'Buy' }),
    };
    const { service, manager, ledgerService } = buildService({
      senderWallet: wallet,
    });

    const result = await service.adjust(
      'admin-1',
      wallet.id,
      -100,
      'Correcting duplicate deposit',
      'idem-11',
    );
    expect(result.balance).toBe('0');
    expect(result.fromWalletId).toBe(wallet.id);
    expect(ledgerService.postAdjustment).toHaveBeenCalledWith(
      manager,
      result.transactionId,
      'Correcting duplicate deposit',
      { id: wallet.id, walletType: wallet.walletType },
      -100n,
    );
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
    walletType: walletType({ name: 'Merchant', supportsAutoWithdraw: true }),
  };
  const savedTransactions: any[] = [];
  const savedPurchases: any[] = [];
  const railSettlementLinks: any[] = [];
  let idCounter = 0;

  const walletsService = {
    lockById: jest.fn(async () => wallet),
    getByIdUnscoped: jest.fn(async () => wallet),
  };

  const manager = {
    update: jest.fn(async (_entity: unknown, _id: string, patch: any) => {
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
      return {
        id: `rail-settlement-${++railSettlementCounter}`,
        status: RailSettlementStatus.COMPLETED,
        ...input,
      };
    }),
  };

  const ledgerService = buildLedgerServiceStub([wallet]);

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
    ledgerService as any,
    {} as any,
    i18nStub as any,
  );

  return {
    service,
    savedTransactions,
    savedPurchases,
    railSettlementsCreated,
    railSettlementLinks,
    ledgerService,
  };
}

describe('TransactionsService.verifyPurchase', () => {
  it('funds a CREDIT wallet from its repository before paying a merchant, then draws down the virtual ceiling', async () => {
    const repositoryWallet: WalletFixture = {
      id: 'repo-1',
      balance: '5000',
      walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
    };
    const creditWallet: WalletFixture = {
      id: 'credit-wallet-1',
      balance: '0',
      virtualAmount: '400',
      repositoryWalletId: 'repo-1',
      walletType: walletType({ code: 'CREDIT', allowPurchaseOut: true }),
    };
    const merchantWallet: WalletFixture = {
      id: 'merchant-wallet-1',
      balance: '0',
      walletType: walletType({ allowPurchaseIn: true }),
    };
    const { service, manager, ledgerService } = buildService({
      senderWallet: creditWallet,
      recipientWallet: merchantWallet,
      repositoryWallet,
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
    // The GL debits the REPOSITORY (the real money), never the credit
    // wallet's own type — see ledgerWalletType's doc comment for why. This
    // also captures 1. the repository's real balance being debited to fund
    // the purchase.
    expect(ledgerService.postMultiLeg).toHaveBeenCalledWith(
      manager,
      'purchase-tx-1',
      expect.any(String),
      [
        {
          wallet: { id: repositoryWallet.id, walletType: repositoryWallet.walletType },
          amount: 150n,
        },
      ],
      [
        {
          wallet: { id: merchantWallet.id, walletType: merchantWallet.walletType },
          amount: 150n,
        },
      ],
    );
    // 2. the credit wallet's remaining credit ceiling (virtualAmount) is
    // drawn down by the repository-funded amount.
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      creditWallet.id,
      { virtualAmount: '250' },
    );
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: TransactionType.TRANSFER,
        fromWalletId: repositoryWallet.id,
        toWalletId: creditWallet.id,
        amount: '150',
        idempotencyKey: 'credit-fund:purchase-tx-1',
      }),
    );
    // 2b. the ceiling draw-down itself gets its own VIRTUAL ledger row,
    // separate from the real-money TRANSFER above.
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: TransactionType.VIRTUAL,
        fromWalletId: creditWallet.id,
        toWalletId: null,
        amount: '150',
        idempotencyKey: 'credit-draw:purchase-tx-1',
        relatedPurchaseId: 'purchase-tx-1',
      }),
    );
    // 3. only now does the purchase itself debit the (now-funded) credit
    // wallet and credit the merchant, same as any regular purchase — already
    // captured by the postMultiLeg assertion above, which debits only the
    // repository (never the credit wallet's own account) and credits only
    // the merchant.
  });

  it('rejects a CREDIT purchase that exceeds the remaining credit line', async () => {
    const repositoryWallet: WalletFixture = {
      id: 'repo-1',
      balance: '5000',
      walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
    };
    const creditWallet: WalletFixture = {
      id: 'credit-wallet-1',
      balance: '0',
      virtualAmount: '100',
      repositoryWalletId: 'repo-1',
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
      repositoryWallet,
    });

    const pendingPurchase = {
      id: 'purchase-tx-2',
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

    await expect(
      service.verifyPurchase('purchase-tx-2'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a CREDIT purchase when the backing repository lacks enough real balance', async () => {
    const repositoryWallet: WalletFixture = {
      id: 'repo-1',
      balance: '100',
      walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
    };
    const creditWallet: WalletFixture = {
      id: 'credit-wallet-1',
      balance: '0',
      virtualAmount: '400',
      repositoryWalletId: 'repo-1',
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
      repositoryWallet,
    });

    const pendingPurchase = {
      id: 'purchase-tx-3',
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

    await expect(
      service.verifyPurchase('purchase-tx-3'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
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
    const { service, manager, ledgerService } = buildService({
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

    // A plain purchase (no repository/support funding) debits the buyer's
    // own wallet type directly.
    expect(ledgerService.postMultiLeg).toHaveBeenCalledWith(
      manager,
      'purchase-tx-2',
      expect.any(String),
      [{ wallet: { id: buyWallet.id, walletType: buyWallet.walletType }, amount: 150n }],
      [
        {
          wallet: { id: merchantWallet.id, walletType: merchantWallet.walletType },
          amount: 150n,
        },
      ],
    );
    expect(manager.update).not.toHaveBeenCalledWith(
      expect.anything(),
      buyWallet.id,
      expect.objectContaining({ virtualAmount: expect.anything() }),
    );
    expect(manager.create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: TransactionType.TRANSFER }),
    );
    expect(manager.create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: TransactionType.VIRTUAL }),
    );
  });

  it('verifies an installment repayment through ZarinPal (not the sandbox IPG) and marks the installment paid', async () => {
    const repositoryWallet: WalletFixture = {
      id: 'repo-1',
      balance: '1000',
      walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
    };
    const creditWallet: WalletFixture = {
      id: 'credit-1',
      balance: '0',
      walletType: walletType({ code: 'CREDIT', allowPurchaseOut: true }),
    };
    const installmentsService = {
      markPaid: jest.fn(async () => undefined),
      computeRepaymentSplit: jest.fn(computeRepaymentSplitFixture),
    };
    const {
      service,
      manager,
      ipgClientService,
      zarinpalClientService,
      ledgerService,
    } = buildService({
      senderWallet: repositoryWallet,
      recipientWallet: creditWallet,
      installmentsService: installmentsService as any,
    });

    const pendingPurchase = {
      id: 'installment-tx-1',
      type: TransactionType.DEPOSIT,
      status: 'PENDING',
      fromWalletId: null,
      toWalletId: repositoryWallet.id,
      amount: '400',
      installmentId: 'installment-1',
      expiresAt: null,
      ipgAuthority: 'zarinpal-auth-1',
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
    // No fee/penalty/unblockFee sub-repositories configured on this CREDIT
    // type, so the whole 400 (principal 350 + fee 50) still lands on the
    // main repository — same balance this test asserted before the
    // fee-split feature existed.
    manager.findOne = jest.fn().mockResolvedValue({
      id: 'installment-1',
      walletId: 'credit-1',
      principalAmount: '350',
      feeAmount: '50',
      amount: '400',
    });

    const result = await service.verifyPurchase('installment-tx-1');

    expect(result.status).toBe('COMPLETED');
    expect(zarinpalClientService.verifyPayment).toHaveBeenCalledWith(
      'zarinpal-auth-1',
      '400',
    );
    expect(ipgClientService.verifyPayment).not.toHaveBeenCalled();
    // No fee sub-repository configured, so the whole 400 (principal 350 +
    // unrouted fee 50) lands on the main repository as one cash-in.
    expect(ledgerService.postCashInMultiLeg).toHaveBeenCalledWith(
      manager,
      'installment-tx-1',
      expect.any(String),
      'BANK_CASH',
      repositoryWallet.walletType.currencyId,
      400n,
      [
        {
          wallet: { id: repositoryWallet.id, walletType: repositoryWallet.walletType },
          amount: 400n,
        },
      ],
    );
    expect(installmentsService.markPaid).toHaveBeenCalledWith(
      manager,
      'installment-1',
      'installment-tx-1',
    );
  });

  it('verifies a plain self-deposit and posts it to the GL as a bank-cash inflow', async () => {
    const depositWallet: WalletFixture = {
      id: 'wallet-a',
      balance: '200',
      walletType: walletType({ name: 'Buy' }),
    };
    const { service, manager, zarinpalClientService, ledgerService } =
      buildService({ senderWallet: depositWallet });

    const pendingDeposit = {
      id: 'deposit-tx-1',
      type: TransactionType.DEPOSIT,
      status: 'PENDING',
      fromWalletId: null,
      toWalletId: depositWallet.id,
      amount: '300',
      installmentId: null,
      settlesWalletId: null,
      completesPurchaseId: null,
      expiresAt: null,
      ipgAuthority: 'zarinpal-auth-1',
    };
    manager.createQueryBuilder = jest.fn(() => {
      const builder: any = {
        setLock: () => builder,
        where: () => builder,
        andWhere: () => builder,
        getOne: async () => pendingDeposit,
      };
      return builder;
    });

    const result = await service.verifyPurchase('deposit-tx-1');

    expect(result.status).toBe('COMPLETED');
    expect(zarinpalClientService.verifyPayment).toHaveBeenCalledWith(
      'zarinpal-auth-1',
      '300',
    );
    expect(ledgerService.postCashMovement).toHaveBeenCalledWith(
      manager,
      'deposit-tx-1',
      expect.any(String),
      { id: depositWallet.id, walletType: depositWallet.walletType },
      300n,
      'BANK_CASH',
    );
  });

  it('credits only the principal to the repository (not the full charge) when fee/penalty sub-repositories are configured', async () => {
    const repositoryWallet: WalletFixture = {
      id: 'repo-1',
      balance: '1000',
      walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
    };
    const feeRepo: WalletFixture = {
      id: 'fee-repo-1',
      balance: '0',
      walletType: walletType({ code: 'MERCHANT_REPOSITORY' }),
    };
    const creditWallet: WalletFixture = {
      id: 'credit-1',
      balance: '0',
      walletType: walletType({
        code: 'CREDIT',
        allowPurchaseOut: true,
        feeRepositoryWalletId: feeRepo.id,
      } as any),
    };
    const installmentsService = {
      markPaid: jest.fn(async () => undefined),
      computeRepaymentSplit: jest.fn(computeRepaymentSplitFixture),
    };
    const { service, manager, walletsService, ledgerService } = buildService({
      senderWallet: repositoryWallet,
      recipientWallet: creditWallet,
      installmentsService: installmentsService as any,
    });
    (walletsService.lockById as jest.Mock).mockImplementation(
      async (_manager: unknown, id: string) => {
        if (id === feeRepo.id) return feeRepo;
        return repositoryWallet;
      },
    );
    (walletsService.getByIdUnscoped as jest.Mock).mockImplementation(
      async (id: string) => {
        if (id === feeRepo.id) return feeRepo;
        if (id === repositoryWallet.id) return repositoryWallet;
        return creditWallet;
      },
    );

    const pendingPurchase = {
      id: 'installment-tx-2',
      type: TransactionType.DEPOSIT,
      status: 'PENDING',
      fromWalletId: null,
      toWalletId: repositoryWallet.id,
      amount: '400',
      installmentId: 'installment-1',
      expiresAt: null,
      ipgAuthority: 'zarinpal-auth-1',
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
    manager.findOne = jest.fn().mockResolvedValue({
      id: 'installment-1',
      walletId: 'credit-1',
      principalAmount: '350',
      feeAmount: '50',
      amount: '400',
    });

    const result = await service.verifyPurchase('installment-tx-2');

    expect(result.status).toBe('COMPLETED');
    // Only the 350 principal lands on the repository (1000 -> 1350), not
    // the full 400 charge — the 50 fee goes to feeRepo instead, and the
    // transaction row itself is shrunk to match what actually landed here.
    expect(pendingPurchase.amount).toBe('350');
    // The whole 400 ZarinPal charge is one cash-in, split across the
    // repository (principal, 350) and the fee sub-repository (50).
    expect(ledgerService.postCashInMultiLeg).toHaveBeenCalledWith(
      manager,
      'installment-tx-2',
      expect.any(String),
      'BANK_CASH',
      repositoryWallet.walletType.currencyId,
      400n,
      [
        {
          wallet: { id: repositoryWallet.id, walletType: repositoryWallet.walletType },
          amount: 350n,
        },
        { wallet: { id: feeRepo.id, walletType: feeRepo.walletType }, amount: 50n },
      ],
    );
  });

  it('verifies an admin overdue-collection payment and settles every outstanding installment on the wallet', async () => {
    const repositoryWallet: WalletFixture = {
      id: 'repo-1',
      balance: '1000',
      walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
    };
    const creditWallet: WalletFixture = {
      id: 'credit-1',
      balance: '0',
      walletType: walletType({ code: 'CREDIT', allowPurchaseOut: true }),
    };
    // Sums to the same 750 the transaction charges: principal 600 + fee 100
    // (penalty 0) leaves 750 - 600 - 100 = 50 recovered as unblockFee. No
    // sub-repositories configured, so it all still lands on the main
    // repository — same balance this test asserted before the fee-split
    // feature existed.
    const installmentsService = {
      markAllPaidAndUnblock: jest.fn(async () => undefined),
      getOutstandingForWallet: jest.fn(async () => [
        { principalAmount: '600', feeAmount: '100', amount: '700' },
      ]),
      computeRepaymentSplit: jest.fn(computeRepaymentSplitFixture),
    };
    const { service, manager, ledgerService } = buildService({
      senderWallet: repositoryWallet,
      recipientWallet: creditWallet,
      installmentsService: installmentsService as any,
    });

    const pendingCollection = {
      id: 'collection-tx-1',
      type: TransactionType.DEPOSIT,
      status: 'PENDING',
      fromWalletId: null,
      toWalletId: repositoryWallet.id,
      amount: '750',
      installmentId: null,
      settlesWalletId: 'credit-1',
      expiresAt: null,
      ipgAuthority: 'zarinpal-auth-1',
    };
    manager.createQueryBuilder = jest.fn(() => {
      const builder: any = {
        setLock: () => builder,
        where: () => builder,
        andWhere: () => builder,
        getOne: async () => pendingCollection,
      };
      return builder;
    });

    const result = await service.verifyPurchase('collection-tx-1');

    expect(result.status).toBe('COMPLETED');
    expect(installmentsService.markAllPaidAndUnblock).toHaveBeenCalledWith(
      manager,
      'credit-1',
      'collection-tx-1',
    );
    expect(ledgerService.postCashInMultiLeg).toHaveBeenCalledWith(
      manager,
      'collection-tx-1',
      expect.any(String),
      'BANK_CASH',
      repositoryWallet.walletType.currencyId,
      750n,
      [
        {
          wallet: { id: repositoryWallet.id, walletType: repositoryWallet.walletType },
          amount: 750n,
        },
      ],
    );
  });
});

describe('TransactionsService.verifyPurchase support top-up completion', () => {
  const repositoryWallet: WalletFixture = {
    id: 'repo-1',
    balance: '5000',
    walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
  };
  const creditWallet: WalletFixture = {
    id: 'credit-wallet-1',
    userId: 'personnel-1',
    balance: '0',
    virtualAmount: '100',
    repositoryWalletId: 'repo-1',
    walletType: walletType({ code: 'CREDIT', allowPurchaseOut: true }),
  };
  const merchantWallet: WalletFixture = {
    id: 'merchant-wallet-1',
    balance: '0',
    callbackUrl: 'https://merchant.example.com/return',
    walletType: walletType({ allowPurchaseIn: true }),
  };
  const supportWallet: WalletFixture = {
    id: 'support-wallet-1',
    userId: 'personnel-1',
    balance: '0',
    walletType: walletType({ code: 'SUPPORT' }),
  };

  function buildTopUpTransactions() {
    const purchase = {
      id: 'purchase-tx-1',
      type: TransactionType.PURCHASE,
      status: 'PENDING',
      fromWalletId: creditWallet.id,
      toWalletId: merchantWallet.id,
      amount: '150',
      installmentId: null,
      expiresAt: null,
      completesPurchaseId: null,
    };
    const topUp = {
      id: 'topup-tx-1',
      type: TransactionType.DEPOSIT,
      status: 'PENDING',
      fromWalletId: null,
      toWalletId: null,
      amount: '50',
      installmentId: null,
      expiresAt: null,
      completesPurchaseId: purchase.id,
      ipgAuthority: 'zarinpal-topup-auth',
    };
    return { purchase, topUp };
  }

  // completeSupportTopUp does its own second createQueryBuilder(...).getOne()
  // call (for the linked purchase) on top of verifyPurchase's own initial
  // lookup (for the top-up itself) — this mock serves whichever of the two
  // rows the current query's id matches.
  function mockQueryBuilderFor(manager: any, rows: Record<string, any>) {
    manager.createQueryBuilder = jest.fn(() => {
      let queriedId: string | undefined;
      const builder: any = {
        setLock: () => builder,
        where: (_cond: string, params: Record<string, string>) => {
          queriedId = Object.values(params)[0];
          return builder;
        },
        andWhere: () => builder,
        getOne: async () => (queriedId ? rows[queriedId] : undefined),
      };
      return builder;
    });
  }

  it('credits the support wallet, completes the purchase, and redirects to the merchant callback', async () => {
    const { service, manager, ledgerService } = buildService({
      senderWallet: creditWallet,
      recipientWallet: merchantWallet,
      repositoryWallet,
      supportWallet,
    });
    const { purchase, topUp } = buildTopUpTransactions();
    mockQueryBuilderFor(manager, {
      [topUp.id]: topUp,
      [purchase.id]: purchase,
    });

    const result = await service.verifyPurchase(topUp.id);

    expect(result).toEqual({
      transactionId: purchase.id,
      status: 'COMPLETED',
      redirectUrl:
        'https://merchant.example.com/return?transactionId=purchase-tx-1&status=COMPLETED',
    });
    // The ZarinPal top-up landing in the support wallet is its own cash-in
    // event, separate from the purchase it goes on to fund.
    expect(ledgerService.postCashMovement).toHaveBeenCalledWith(
      manager,
      'topup-tx-1',
      expect.any(String),
      { id: supportWallet.id, walletType: supportWallet.walletType },
      50n,
      'BANK_CASH',
    );
    // The purchase itself debits both real funding sources — the support
    // wallet for its slice, the repository for the rest — never the credit
    // wallet's own type.
    expect(ledgerService.postMultiLeg).toHaveBeenCalledWith(
      manager,
      'purchase-tx-1',
      expect.any(String),
      [
        { wallet: { id: supportWallet.id, walletType: supportWallet.walletType }, amount: 50n },
        {
          wallet: { id: repositoryWallet.id, walletType: repositoryWallet.walletType },
          amount: 100n,
        },
      ],
      [
        {
          wallet: { id: merchantWallet.id, walletType: merchantWallet.walletType },
          amount: 150n,
        },
      ],
    );
  });

  it('does not re-credit the support wallet on a repeat verify call for an already-completed top-up', async () => {
    const { service, manager } = buildService({
      senderWallet: creditWallet,
      recipientWallet: merchantWallet,
      repositoryWallet,
      supportWallet: { ...supportWallet, balance: '50' },
    });
    const { purchase, topUp } = buildTopUpTransactions();
    topUp.status = 'COMPLETED';
    purchase.status = 'COMPLETED';
    mockQueryBuilderFor(manager, {
      [topUp.id]: topUp,
      [purchase.id]: purchase,
    });

    const result = await service.verifyPurchase(topUp.id);

    expect(result.status).toBe('COMPLETED');
    expect(result.redirectUrl).toBe(
      'https://merchant.example.com/return?transactionId=purchase-tx-1&status=COMPLETED',
    );
    expect(manager.update).not.toHaveBeenCalledWith(
      expect.anything(),
      supportWallet.id,
      expect.anything(),
    );
  });
});

describe('TransactionsService.sweepAutoWithdraw', () => {
  it('falls back to a single full-balance WITHDRAW when no settlement split is configured (legacy behavior)', async () => {
    const { service, savedTransactions, ledgerService } =
      buildSweepService({
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
    expect(ledgerService.postCashMovement).toHaveBeenCalledWith(
      expect.anything(),
      'withdraw-1',
      expect.any(String),
      expect.objectContaining({
        id: 'wallet-1',
        walletType: expect.objectContaining({ name: 'Merchant' }),
      }),
      -5000n,
      'BANK_CASH',
    );
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

    const { service, savedTransactions, savedPurchases } =
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
      walletType: walletType({ name: 'Repository', depositable: false }),
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

    expect(result.redirectUrl).toBe(
      'https://sandbox.zarinpal.com/pg/StartPay/zarinpal-auth-1',
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TransactionType.DEPOSIT,
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

describe('TransactionsService overdue-collection methods', () => {
  const repositoryWallet: WalletFixture = {
    id: 'repo-1',
    balance: '5000',
    walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
  };

  const blockedCreditWallet: WalletFixture = {
    id: 'credit-1',
    userId: 'personnel-1',
    balance: '0',
    blockedAt: new Date(),
    repositoryWalletId: 'repo-1',
    walletType: walletType({ code: 'CREDIT', unblockFee: '50' }),
  };

  function buildOverdueService(wallet: WalletFixture = blockedCreditWallet) {
    // principal 350+250=600, fee 50+30=80, penalty (400-350-50)+(300-250-30)=20,
    // unblockFee (walletType.unblockFee) 50 — 600+80+20+50 = 750 total owed,
    // matching every existing assertion below.
    const installmentsService = {
      getOutstandingForWallet: jest.fn(async () => [
        { amount: '400', principalAmount: '350', feeAmount: '50' },
        { amount: '300', principalAmount: '250', feeAmount: '30' },
      ]),
      markAllPaidAndUnblock: jest.fn(async () => undefined),
      computeRepaymentSplit: jest.fn(computeRepaymentSplitFixture),
    };
    return {
      ...buildService({
        senderWallet: wallet,
        repositoryWallet,
        installmentsService: installmentsService as any,
      }),
      installmentsService,
    };
  }

  it('rejects collecting from a wallet that is not currently blocked', async () => {
    const { service } = buildOverdueService({
      ...blockedCreditWallet,
      blockedAt: null,
    });

    await expect(
      service.collectOverdueFromRepository(
        'admin-1',
        'credit-1',
        'Wrote off as uncollectable',
        null,
        'idem-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('collectOverdueFromRepository writes off the principal and leaves fee/penalty/unblockFee on the repository when no sub-repositories are configured', async () => {
    const { service, manager, installmentsService, ledgerService } =
      buildOverdueService();

    const result = await service.collectOverdueFromRepository(
      'admin-1',
      'credit-1',
      'Wrote off as uncollectable',
      null,
      'idem-2',
    );

    // fee 80 + penalty 20 + unblockFee 50 = 150 recorded, but none of it
    // has anywhere configured to route to, so nothing actually leaves the
    // repository (the 600 principal was already spent at purchase time and
    // is never touched here either way).
    expect(result.balance).toBe('5000');
    expect(manager.update).not.toHaveBeenCalledWith(
      expect.anything(),
      'repo-1',
      expect.anything(),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TransactionType.ADJUSTMENT,
        fromWalletId: 'repo-1',
        toWalletId: null,
        amount: '150',
      }),
    );
    expect(installmentsService.markAllPaidAndUnblock).toHaveBeenCalledWith(
      manager,
      'credit-1',
      undefined,
    );
    // Nothing real moved (nowhere configured to route to, and the
    // written-off principal was never Packeta's own receivable), so no GL
    // entry at all.
    expect(ledgerService.postMultiLeg).not.toHaveBeenCalled();
  });

  it('collectOverdueFromRepository routes fee/penalty/unblockFee to their configured sub-repositories instead of the main repository', async () => {
    const feeRepo: WalletFixture = {
      id: 'fee-repo-1',
      balance: '0',
      walletType: walletType({ code: 'MERCHANT_REPOSITORY' }),
    };
    const penaltyRepo: WalletFixture = {
      id: 'penalty-repo-1',
      balance: '0',
      walletType: walletType({ code: 'MERCHANT_REPOSITORY' }),
    };
    const unblockRepo: WalletFixture = {
      id: 'unblock-repo-1',
      balance: '0',
      walletType: walletType({ code: 'MERCHANT_REPOSITORY' }),
    };
    const wired: WalletFixture = {
      ...blockedCreditWallet,
      walletType: walletType({
        code: 'CREDIT',
        unblockFee: '50',
        feeRepositoryWalletId: feeRepo.id,
        penaltyRepositoryWalletId: penaltyRepo.id,
        unblockFeeRepositoryWalletId: unblockRepo.id,
      } as any),
    };
    const installmentsService = {
      getOutstandingForWallet: jest.fn(async () => [
        { amount: '400', principalAmount: '350', feeAmount: '50' },
        { amount: '300', principalAmount: '250', feeAmount: '30' },
      ]),
      markAllPaidAndUnblock: jest.fn(async () => undefined),
      computeRepaymentSplit: jest.fn(computeRepaymentSplitFixture),
    };
    const { service, manager, walletsService, ledgerService } = buildService({
      senderWallet: wired,
      repositoryWallet,
      installmentsService: installmentsService as any,
    });
    (walletsService.lockById as jest.Mock).mockImplementation(
      async (_manager: unknown, id: string) => {
        if (id === feeRepo.id) return feeRepo;
        if (id === penaltyRepo.id) return penaltyRepo;
        if (id === unblockRepo.id) return unblockRepo;
        return repositoryWallet;
      },
    );
    (walletsService.getByIdUnscoped as jest.Mock).mockImplementation(
      async (id: string) => {
        if (id === feeRepo.id) return feeRepo;
        if (id === penaltyRepo.id) return penaltyRepo;
        if (id === unblockRepo.id) return unblockRepo;
        if (id === repositoryWallet.id) return repositoryWallet;
        return wired;
      },
    );

    const result = await service.collectOverdueFromRepository(
      'admin-1',
      'credit-1',
      'Wrote off as uncollectable',
      null,
      'idem-2b',
    );

    // fee 80, penalty 20, unblockFee 50 — every one of the 3 legs has a
    // configured destination this time, so the whole 150 leaves the main
    // repository (5000 -> 4850) and lands on the 3 sub-repositories.
    expect(result.balance).toBe('4850');
    expect(ledgerService.postMultiLeg).toHaveBeenCalledWith(
      manager,
      result.transactionId,
      expect.any(String),
      [
        {
          wallet: { id: repositoryWallet.id, walletType: repositoryWallet.walletType },
          amount: 150n,
        },
      ],
      [
        { wallet: { id: feeRepo.id, walletType: feeRepo.walletType }, amount: 80n },
        { wallet: { id: penaltyRepo.id, walletType: penaltyRepo.walletType }, amount: 20n },
        { wallet: { id: unblockRepo.id, walletType: unblockRepo.walletType }, amount: 50n },
      ],
    );
  });

  it('collectOverdueFromRepository rejects when the repository cannot cover the routed debt', async () => {
    const feeRepo: WalletFixture = {
      id: 'fee-repo-1',
      balance: '0',
      walletType: walletType({ code: 'MERCHANT_REPOSITORY' }),
    };
    const poorRepository: WalletFixture = {
      ...repositoryWallet,
      balance: '10',
    };
    const wired: WalletFixture = {
      ...blockedCreditWallet,
      walletType: walletType({
        code: 'CREDIT',
        unblockFee: '50',
        feeRepositoryWalletId: feeRepo.id,
      } as any),
    };
    const installmentsService = {
      getOutstandingForWallet: jest.fn(async () => [
        { amount: '400', principalAmount: '350', feeAmount: '50' },
      ]),
      markAllPaidAndUnblock: jest.fn(async () => undefined),
      computeRepaymentSplit: jest.fn(computeRepaymentSplitFixture),
    };
    const { service, walletsService } = buildService({
      senderWallet: wired,
      repositoryWallet: poorRepository,
      installmentsService: installmentsService as any,
    });
    (walletsService.lockById as jest.Mock).mockImplementation(
      async (_manager: unknown, id: string) =>
        id === feeRepo.id ? feeRepo : poorRepository,
    );
    (walletsService.getByIdUnscoped as jest.Mock).mockImplementation(
      async (id: string) => {
        if (id === feeRepo.id) return feeRepo;
        if (id === poorRepository.id) return poorRepository;
        return wired;
      },
    );

    await expect(
      service.collectOverdueFromRepository(
        'admin-1',
        'credit-1',
        'Wrote off as uncollectable',
        null,
        'idem-3',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('collectOverdueFromRepository records the description and document reference as evidence for the write-off', async () => {
    const { service, manager, installmentsService } = buildOverdueService();

    const result = await service.collectOverdueFromRepository(
      'admin-1',
      'credit-1',
      'Customer unreachable, approved by finance',
      'approval-123.pdf',
      'idem-4',
    );

    // No sub-repositories configured, so nothing actually leaves the
    // repository — same balance as the plain write-off test — but the note
    // now carries the justification and document reference.
    expect(result.balance).toBe('5000');
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TransactionType.ADJUSTMENT,
        fromWalletId: 'repo-1',
        toWalletId: null,
        amount: '150',
        note: expect.stringContaining(
          'Customer unreachable, approved by finance',
        ),
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        note: expect.stringContaining('approval-123.pdf'),
      }),
    );
    expect(installmentsService.markAllPaidAndUnblock).toHaveBeenCalledWith(
      manager,
      'credit-1',
      undefined,
    );
  });

  it('initiateOverdueCollectionZarinPal creates a walletless DEPOSIT for the full outstanding total, tagged with settlesWalletId', async () => {
    const { service, manager, zarinpalClientService } = buildOverdueService();

    const result = await service.initiateOverdueCollectionZarinPal(
      'admin-1',
      'credit-1',
      'idem-5',
    );

    expect(result.redirectUrl).toBe(
      'https://sandbox.zarinpal.com/pg/StartPay/zarinpal-auth-1',
    );
    expect(zarinpalClientService.createPayment).toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TransactionType.DEPOSIT,
        fromWalletId: null,
        toWalletId: 'repo-1',
        amount: '750',
        settlesWalletId: 'credit-1',
      }),
    );
  });
});

describe('TransactionsService offboarding (quit-customer) methods', () => {
  const repositoryWallet: WalletFixture = {
    id: 'repo-1',
    balance: '5000',
    virtualAmount: '200',
    walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
  };

  // Deliberately NOT blocked — offboarding must work on a credit wallet in
  // good standing, unlike the overdue-collection methods above.
  const openCreditWallet: WalletFixture = {
    id: 'credit-1',
    userId: 'personnel-1',
    balance: '0',
    virtualAmount: '150',
    blockedAt: null,
    repositoryWalletId: 'repo-1',
    walletType: walletType({ code: 'CREDIT', unblockFee: '50' }),
  };

  function buildQuitService(
    wallet: WalletFixture = openCreditWallet,
    outstanding: {
      amount: string;
      principalAmount: string;
      feeAmount: string;
    }[] = [{ amount: '400', principalAmount: '350', feeAmount: '50' }],
  ) {
    const installmentsService = {
      getOutstandingForWallet: jest.fn(async () => outstanding),
      markAllPaidAndUnblock: jest.fn(async () => undefined),
      computeRepaymentSplit: jest.fn(computeRepaymentSplitFixture),
    };
    return {
      ...buildService({
        senderWallet: wallet,
        repositoryWallet,
        installmentsService: installmentsService as any,
      }),
      installmentsService,
    };
  }

  it('initiateQuitCollectionZarinPal works on a wallet that is not blocked and never folds in unblockFee', async () => {
    const { service, manager, zarinpalClientService } = buildQuitService();

    const result = await service.initiateQuitCollectionZarinPal(
      'admin-1',
      'credit-1',
      'idem-quit-1',
    );

    expect(result.redirectUrl).toBe(
      'https://sandbox.zarinpal.com/pg/StartPay/zarinpal-auth-1',
    );
    expect(zarinpalClientService.createPayment).toHaveBeenCalled();
    // Just the one outstanding installment's amount (400) — the type's
    // unblockFee (50) never applies here, unlike the overdue-queue version.
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TransactionType.DEPOSIT,
        toWalletId: 'repo-1',
        amount: '400',
        settlesWalletId: 'credit-1',
      }),
    );
  });

  it('collectQuitDebtFromRepository never charges unblockFee and works on a non-blocked wallet', async () => {
    const { service, manager, installmentsService } = buildQuitService();

    const result = await service.collectQuitDebtFromRepository(
      'admin-1',
      'credit-1',
      'Customer requested account closure',
      null,
      'idem-quit-2',
    );

    // fee 50 + penalty 0 = 50 recorded, no unblockFee component at all.
    expect(result.balance).toBe('5000');
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TransactionType.ADJUSTMENT,
        fromWalletId: 'repo-1',
        amount: '50',
      }),
    );
    expect(installmentsService.markAllPaidAndUnblock).toHaveBeenCalledWith(
      manager,
      'credit-1',
      undefined,
    );
  });

  it('closeCreditWalletAndReclaim rejects while the wallet still owes an outstanding balance', async () => {
    const { service } = buildQuitService();

    await expect(
      service.closeCreditWalletAndReclaim('admin-1', 'credit-1', 'idem-quit-3'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('closeCreditWalletAndReclaim hands the unused virtualAmount ceiling back to the repository and closes the wallet once nothing is owed', async () => {
    const { service, manager } = buildQuitService(openCreditWallet, []);

    const result = await service.closeCreditWalletAndReclaim(
      'admin-1',
      'credit-1',
      'idem-quit-4',
    );

    expect(result).toEqual({ walletId: 'credit-1', reclaimed: '150' });
    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'repo-1', {
      virtualAmount: '350', // repository's existing 200 + reclaimed 150
    });
    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'credit-1', {
      virtualAmount: '0',
    });
    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'credit-1', {
      closedAt: expect.any(Date),
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TransactionType.VIRTUAL,
        fromWalletId: 'credit-1',
        toWalletId: 'repo-1',
        amount: '150',
      }),
    );
  });

  it('closeCreditWalletAndReclaim rejects a wallet that is already closed', async () => {
    const { service } = buildQuitService(
      { ...openCreditWallet, closedAt: new Date() },
      [],
    );

    await expect(
      service.closeCreditWalletAndReclaim('admin-1', 'credit-1', 'idem-quit-5'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TransactionsService.getHistory', () => {
  function buildHistoryService(wallets: WalletFixture[]) {
    const walletsService = {
      listForUser: jest.fn(async () => wallets),
      getById: jest.fn(async (_userId: string, walletId: string) => {
        const wallet = wallets.find((w) => w.id === walletId);
        if (!wallet) throw new NotFoundException('Wallet not found');
        return wallet;
      }),
    };
    const transactionsRepository = { find: jest.fn(async () => []) };
    const service = new TransactionsService(
      {} as any,
      walletsService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      transactionsRepository as any,
      i18nStub as any,
    );
    return { service, transactionsRepository };
  }

  it('excludes wallets whose type is hiddenFromCustomer when listing every wallet', async () => {
    const visible: WalletFixture = {
      id: 'w-visible',
      balance: '0',
      walletType: walletType({ hiddenFromCustomer: false } as any),
    };
    const hidden: WalletFixture = {
      id: 'w-hidden',
      balance: '0',
      walletType: walletType({ hiddenFromCustomer: true } as any),
    };
    const { service, transactionsRepository } = buildHistoryService([
      visible,
      hidden,
    ]);

    await service.getHistory('user-1');

    expect(transactionsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          { fromWalletId: expect.objectContaining({ _value: ['w-visible'] }) },
          { toWalletId: expect.objectContaining({ _value: ['w-visible'] }) },
        ],
      }),
    );
  });

  it("still returns a specific hidden wallet's history when walletId is explicitly requested", async () => {
    const hidden: WalletFixture = {
      id: 'w-hidden',
      balance: '0',
      walletType: walletType({ hiddenFromCustomer: true } as any),
    };
    const { service, transactionsRepository } = buildHistoryService([hidden]);

    await service.getHistory('user-1', 'w-hidden');

    expect(transactionsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [
          { fromWalletId: expect.objectContaining({ _value: ['w-hidden'] }) },
          { toWalletId: expect.objectContaining({ _value: ['w-hidden'] }) },
        ],
      }),
    );
  });
});

describe('TransactionsService.reverseTransaction', () => {
  // Mirrors settleCreditFundedPurchase's ledger convention: the repository
  // leg is a TRANSFER from the repository to the credit wallet, keyed
  // deterministically by `credit-fund:${purchaseId}`.
  function mockQueryBuilderFor(manager: any, original: any) {
    manager.createQueryBuilder = jest.fn(() => {
      const builder: any = {
        setLock: () => builder,
        where: () => builder,
        andWhere: () => builder,
        getOne: async () => original,
      };
      return builder;
    });
  }

  function mockRepositoryLeg(manager: any, leg: any | undefined) {
    manager.findOne = jest.fn(async (_entity: unknown, opts: any) => {
      if (leg && opts?.where?.idempotencyKey === leg.idempotencyKey) {
        return leg;
      }
      return undefined;
    });
  }

  it('reverses a plain (non-credit) purchase by refunding the full amount to the customer', async () => {
    const customerWallet: WalletFixture = {
      id: 'customer-1',
      userId: 'user-1',
      balance: '0',
      walletType: walletType({ allowPurchaseOut: true }),
    };
    const merchantWallet: WalletFixture = {
      id: 'merchant-1',
      balance: '500',
      walletType: walletType({ allowPurchaseIn: true }),
    };
    const { service, manager, ledgerService } = buildService({
      senderWallet: customerWallet,
      recipientWallet: merchantWallet,
    });
    const original = {
      id: 'purchase-1',
      type: TransactionType.PURCHASE,
      status: 'COMPLETED',
      fromWalletId: customerWallet.id,
      toWalletId: merchantWallet.id,
      amount: '500',
    };
    mockQueryBuilderFor(manager, original);
    mockRepositoryLeg(manager, undefined);

    const result = await service.reverseTransaction(
      'user-1',
      'purchase-1',
      'not as described',
      'idem-reverse-1',
    );

    expect(ledgerService.postReversal).toHaveBeenCalledWith(
      manager,
      'purchase-1',
      undefined,
      'not as described',
      [{ wallet: { id: merchantWallet.id, walletType: merchantWallet.walletType }, amount: 500n }],
      [{ wallet: { id: customerWallet.id, walletType: customerWallet.walletType }, amount: 500n }],
    );
    expect(manager.update).not.toHaveBeenCalledWith(
      expect.anything(),
      'repo-1',
      expect.anything(),
    );
    expect(result.balance).toBe('500');
    expect(original.status).toBe('REVERSED');
  });

  it('reverses a fully repository-funded CREDIT purchase by returning the money to the repository and restoring the ceiling, leaving the customer real balance untouched', async () => {
    const repositoryWallet: WalletFixture = {
      id: 'repo-1',
      balance: '4200',
      walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
    };
    const creditWallet: WalletFixture = {
      id: 'credit-wallet-1',
      userId: 'personnel-1',
      balance: '0',
      virtualAmount: '0',
      repositoryWalletId: 'repo-1',
      walletType: walletType({
        code: 'CREDIT',
        allowPurchaseOut: true,
        allowNegativeBalance: true,
        creditLimit: '1000',
      }),
    };
    const merchantWallet: WalletFixture = {
      id: 'merchant-wallet-1',
      balance: '800',
      walletType: walletType({ allowPurchaseIn: true }),
    };
    const { service, manager, ledgerService } = buildService({
      senderWallet: creditWallet,
      recipientWallet: merchantWallet,
      repositoryWallet,
    });
    const original = {
      id: 'purchase-2',
      type: TransactionType.PURCHASE,
      status: 'COMPLETED',
      fromWalletId: creditWallet.id,
      toWalletId: merchantWallet.id,
      amount: '800',
    };
    mockQueryBuilderFor(manager, original);
    mockRepositoryLeg(manager, {
      id: 'fund-1',
      fromWalletId: repositoryWallet.id,
      toWalletId: creditWallet.id,
      amount: '800',
      idempotencyKey: `credit-fund:${original.id}`,
    });

    const result = await service.reverseTransaction(
      'personnel-1',
      'purchase-2',
      undefined,
      'idem-reverse-2',
    );

    // Fully repository-funded: the whole refund goes back to the
    // repository, never to the credit wallet's own type — and, since the
    // customer's own account never appears as a credit leg here, its real
    // balance stays exactly where it was.
    expect(ledgerService.postReversal).toHaveBeenCalledWith(
      manager,
      'purchase-2',
      undefined,
      'Refund',
      [{ wallet: { id: merchantWallet.id, walletType: merchantWallet.walletType }, amount: 800n }],
      [{ wallet: { id: repositoryWallet.id, walletType: repositoryWallet.walletType }, amount: 800n }],
    );
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      creditWallet.id,
      {
        virtualAmount: '800',
      },
    );
    expect(result.balance).toBe('0');

    const savedCalls = manager.save.mock.calls.map((call: any[]) => call[0]);
    expect(savedCalls).toContainEqual(
      expect.objectContaining({
        type: TransactionType.TRANSFER,
        fromWalletId: creditWallet.id,
        toWalletId: repositoryWallet.id,
        amount: '800',
        idempotencyKey: 'credit-fund-reverse:purchase-2',
      }),
    );
    expect(savedCalls).toContainEqual(
      expect.objectContaining({
        type: TransactionType.VIRTUAL,
        fromWalletId: null,
        toWalletId: creditWallet.id,
        amount: '800',
        idempotencyKey: 'credit-draw-reverse:purchase-2',
        relatedPurchaseId: 'purchase-2',
      }),
    );
  });

  it('reverses a mixed repository+support-funded CREDIT purchase: repository gets its slice back with the ceiling restored, customer real balance only receives the support (ZarinPal) slice', async () => {
    const repositoryWallet: WalletFixture = {
      id: 'repo-1',
      balance: '4300',
      walletType: walletType({ name: 'Repository', allowPurchaseIn: true }),
    };
    const creditWallet: WalletFixture = {
      id: 'credit-wallet-1',
      userId: 'personnel-1',
      balance: '0',
      virtualAmount: '300',
      repositoryWalletId: 'repo-1',
      walletType: walletType({
        code: 'CREDIT',
        allowPurchaseOut: true,
        allowNegativeBalance: true,
        creditLimit: '1000',
      }),
    };
    const merchantWallet: WalletFixture = {
      id: 'merchant-wallet-1',
      balance: '1000',
      walletType: walletType({ allowPurchaseIn: true }),
    };
    const { service, manager, ledgerService } = buildService({
      senderWallet: creditWallet,
      recipientWallet: merchantWallet,
      repositoryWallet,
    });
    const original = {
      id: 'purchase-3',
      type: TransactionType.PURCHASE,
      status: 'COMPLETED',
      fromWalletId: creditWallet.id,
      toWalletId: merchantWallet.id,
      amount: '1000',
    };
    mockQueryBuilderFor(manager, original);
    mockRepositoryLeg(manager, {
      id: 'fund-2',
      fromWalletId: repositoryWallet.id,
      toWalletId: creditWallet.id,
      amount: '700',
      idempotencyKey: `credit-fund:${original.id}`,
    });

    const result = await service.reverseTransaction(
      'personnel-1',
      'purchase-3',
      undefined,
      'idem-reverse-3',
    );

    // The support-funded slice (300) credits the credit wallet's own type
    // directly; the repository-funded slice (700) credits the repository.
    // Only that support-funded slice — 1000 total minus 700 from the
    // repository — comes back as real balance on the credit wallet.
    expect(ledgerService.postReversal).toHaveBeenCalledWith(
      manager,
      'purchase-3',
      undefined,
      'Refund',
      [{ wallet: { id: merchantWallet.id, walletType: merchantWallet.walletType }, amount: 1000n }],
      [
        { wallet: { id: creditWallet.id, walletType: creditWallet.walletType }, amount: 300n },
        { wallet: { id: repositoryWallet.id, walletType: repositoryWallet.walletType }, amount: 700n },
      ],
    );
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      creditWallet.id,
      {
        virtualAmount: '1000',
      },
    );
    expect(result.balance).toBe('300');
  });

  it('rejects reversing an already-reversed purchase', async () => {
    const customerWallet: WalletFixture = {
      id: 'customer-1',
      userId: 'user-1',
      balance: '0',
      walletType: walletType({ allowPurchaseOut: true }),
    };
    const merchantWallet: WalletFixture = {
      id: 'merchant-1',
      balance: '500',
      walletType: walletType({ allowPurchaseIn: true }),
    };
    const { service, manager } = buildService({
      senderWallet: customerWallet,
      recipientWallet: merchantWallet,
    });
    const original = {
      id: 'purchase-4',
      type: TransactionType.PURCHASE,
      status: 'REVERSED',
      fromWalletId: customerWallet.id,
      toWalletId: merchantWallet.id,
      amount: '500',
    };
    mockQueryBuilderFor(manager, original);

    await expect(
      service.reverseTransaction(
        'user-1',
        'purchase-4',
        undefined,
        'idem-reverse-4',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
