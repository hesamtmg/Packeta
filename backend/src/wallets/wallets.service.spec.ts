import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { SettlementRailType } from '../rail-settlements/entities/rail-settlement.entity';

function buildService(wallet: {
  id: string;
  userId: string;
  balance: string;
  closedAt: Date | null;
}) {
  const walletsRepository = {
    findOne: jest.fn(async () => wallet),
    update: jest.fn(async (_id: string, patch: Partial<typeof wallet>) => {
      Object.assign(wallet, patch);
    }),
  };
  const settlementService = {};
  const walletTypesService = {};
  const usersService = {};
  const service = new WalletsService(
    walletsRepository as any,
    settlementService as any,
    walletTypesService as any,
    usersService as any,
    {} as any,
  );
  return { service, walletsRepository };
}

describe('WalletsService.isCounterpartyAllowed', () => {
  const service = new WalletsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  it('allows the pairing when neither wallet has a restriction list', () => {
    expect(
      service.isCounterpartyAllowed(null, 'b@x.com', null, 'a@x.com'),
    ).toBe(true);
  });

  it("allows the pairing when wallet A's own list contains B, regardless of B's list", () => {
    expect(
      service.isCounterpartyAllowed(
        ['b@x.com'],
        'b@x.com',
        ['someone-else@x.com'],
        'a@x.com',
      ),
    ).toBe(true);
  });

  it("allows the pairing when wallet B's own list contains A, regardless of A's list", () => {
    expect(
      service.isCounterpartyAllowed(
        ['someone-else@x.com'],
        'b@x.com',
        ['a@x.com'],
        'a@x.com',
      ),
    ).toBe(true);
  });

  it('blocks the pairing when both sides have a list and neither contains the other party', () => {
    expect(
      service.isCounterpartyAllowed(
        ['someone-else@x.com'],
        'b@x.com',
        ['someone-else-too@x.com'],
        'a@x.com',
      ),
    ).toBe(false);
  });

  it('blocks the pairing when only A has a list and it does not contain B', () => {
    expect(
      service.isCounterpartyAllowed(
        ['someone-else@x.com'],
        'b@x.com',
        null,
        'a@x.com',
      ),
    ).toBe(false);
  });

  it('treats an empty restriction array the same as null (no restriction)', () => {
    expect(service.isCounterpartyAllowed([], 'b@x.com', [], 'a@x.com')).toBe(
      true,
    );
  });
});

describe('WalletsService.closeForUser', () => {
  it('rejects closing a wallet with a nonzero balance', async () => {
    const { service } = buildService({
      id: 'wallet-1',
      userId: 'user-1',
      balance: '500',
      closedAt: null,
    });

    await expect(
      service.closeForUser('user-1', 'wallet-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects closing a wallet that is already closed', async () => {
    const { service } = buildService({
      id: 'wallet-1',
      userId: 'user-1',
      balance: '0',
      closedAt: new Date(),
    });

    await expect(
      service.closeForUser('user-1', 'wallet-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('closes a zero-balance wallet by stamping closedAt', async () => {
    const { service, walletsRepository } = buildService({
      id: 'wallet-1',
      userId: 'user-1',
      balance: '0',
      closedAt: null,
    });

    const result = await service.closeForUser('user-1', 'wallet-1');

    expect(walletsRepository.update).toHaveBeenCalledWith(
      'wallet-1',
      expect.objectContaining({ closedAt: expect.any(Date) }),
    );
    expect(result.closedAt).toBeInstanceOf(Date);
  });
});

describe('WalletsService.reopenAsAdmin', () => {
  it('rejects reopening a wallet that is not closed', async () => {
    const { service } = buildService({
      id: 'wallet-1',
      userId: 'user-1',
      balance: '0',
      closedAt: null,
    });

    await expect(service.reopenAsAdmin('wallet-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('clears closedAt on a closed wallet', async () => {
    const { service, walletsRepository } = buildService({
      id: 'wallet-1',
      userId: 'user-1',
      balance: '0',
      closedAt: new Date(),
    });

    const result = await service.reopenAsAdmin('wallet-1');

    expect(walletsRepository.update).toHaveBeenCalledWith('wallet-1', {
      closedAt: null,
    });
    expect(result.closedAt).toBeNull();
  });
});

describe('WalletsService.assertWithinTransactionLimits', () => {
  const service = new WalletsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  function wallet(min: string | null, max: string | null) {
    return { minTransactionAmount: min, maxTransactionAmount: max } as any;
  }

  it('allows any amount when neither bound is set', () => {
    expect(() =>
      service.assertWithinTransactionLimits(wallet(null, null), 1),
    ).not.toThrow();
  });

  it('rejects an amount below the configured minimum', () => {
    expect(() =>
      service.assertWithinTransactionLimits(wallet('100', null), 50),
    ).toThrow(UnprocessableEntityException);
  });

  it('allows an amount exactly at the configured minimum', () => {
    expect(() =>
      service.assertWithinTransactionLimits(wallet('100', null), 100),
    ).not.toThrow();
  });

  it('rejects an amount above the configured maximum', () => {
    expect(() =>
      service.assertWithinTransactionLimits(wallet(null, '1000'), 1001),
    ).toThrow(UnprocessableEntityException);
  });

  it('allows an amount exactly at the configured maximum', () => {
    expect(() =>
      service.assertWithinTransactionLimits(wallet(null, '1000'), 1000),
    ).not.toThrow();
  });

  it('accepts a bigint amount', () => {
    expect(() =>
      service.assertWithinTransactionLimits(wallet('100', '1000'), 500n),
    ).not.toThrow();
  });
});

describe('WalletsService.createForUser / updateForUser limit validation', () => {
  it('rejects creating a wallet whose minTransactionAmount exceeds its maxTransactionAmount', async () => {
    const manager = { create: jest.fn(), save: jest.fn() };
    const service = new WalletsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.createForUser(manager as any, 'user-1', 'type-1', {
        minTransactionAmount: 1000,
        maxTransactionAmount: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.create).not.toHaveBeenCalled();
  });

  it("rejects updating maxTransactionAmount below the wallet's existing minTransactionAmount", async () => {
    const { service } = buildService({
      id: 'wallet-1',
      userId: 'user-1',
      balance: '0',
      closedAt: null,
      minTransactionAmount: '500',
      maxTransactionAmount: null,
    } as any);

    await expect(
      service.updateForUser({} as any, 'user-1', 'wallet-1', {
        maxTransactionAmount: 100,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('WalletsService.createForUser / updateForUser rail validation', () => {
  it('rejects a BANK_TRANSFER rail with no railScheduleTimes at creation', async () => {
    const manager = { create: jest.fn(), save: jest.fn() };
    const service = new WalletsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.createForUser(manager as any, 'user-1', 'type-1', {
        railType: SettlementRailType.BANK_TRANSFER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.create).not.toHaveBeenCalled();
  });

  it('allows a BANK_TRANSFER rail when railScheduleTimes is supplied', async () => {
    const manager = {
      create: jest.fn((_entity: unknown, data: unknown) => data),
      save: jest.fn(async (data: any) => data),
    };
    const service = new WalletsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.createForUser(manager as any, 'user-1', 'type-1', {
        railType: SettlementRailType.BANK_TRANSFER,
        railScheduleTimes: ['09:00'],
      }),
    ).resolves.toBeDefined();
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        railType: SettlementRailType.BANK_TRANSFER,
        railScheduleTimes: ['09:00'],
      }),
    );
  });

  it('allows a PAYA rail with no railScheduleTimes (falls back to the built-in default at sweep time)', async () => {
    const manager = {
      create: jest.fn((_entity: unknown, data: unknown) => data),
      save: jest.fn(async (data: any) => data),
    };
    const service = new WalletsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.createForUser(manager as any, 'user-1', 'type-1', {
        railType: SettlementRailType.PAYA,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects switching an existing wallet to BANK_TRANSFER without supplying a schedule', async () => {
    const { service } = buildService({
      id: 'wallet-1',
      userId: 'user-1',
      balance: '0',
      closedAt: null,
      railType: null,
      railScheduleTimes: null,
    } as any);

    await expect(
      service.updateForUser({} as any, 'user-1', 'wallet-1', {
        railType: SettlementRailType.BANK_TRANSFER,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows switching to BANK_TRANSFER when the same request also supplies a schedule', async () => {
    const { service } = buildService({
      id: 'wallet-1',
      userId: 'user-1',
      balance: '0',
      closedAt: null,
      railType: null,
      railScheduleTimes: null,
      walletType: {},
    } as any);
    const manager = {
      update: jest.fn(async () => undefined),
      findOne: jest.fn(async () => ({ id: 'wallet-1' })),
    };

    await expect(
      service.updateForUser(manager as any, 'user-1', 'wallet-1', {
        railType: SettlementRailType.BANK_TRANSFER,
        railScheduleTimes: ['10:00'],
      }),
    ).resolves.toBeDefined();
  });
});

describe('WalletsService.grantCredit', () => {
  function buildGrantService(options: {
    repository: {
      id: string;
      userId: string;
      closedAt: Date | null;
      virtualAmount: string | null;
      walletType: { code: string; currencyId: string };
    };
    creditWalletType?: { id: string; code: string; currencyId: string };
    personnel?: { id: string } | null;
  }) {
    const walletsRepository = {
      findOne: jest.fn(async () => options.repository),
    };
    const walletTypesService = {
      findById: jest.fn(
        async () =>
          options.creditWalletType ?? {
            id: 'credit-type-1',
            code: 'CREDIT',
            currencyId: options.repository.walletType.currencyId,
          },
      ),
    };
    const usersService = {
      findByPhoneNumber: jest.fn(async () =>
        options.personnel === undefined
          ? { id: 'personnel-1' }
          : options.personnel,
      ),
    };
    const settlementService = {};
    const idempotencyService = {
      claim: jest.fn(async () => ({ replay: false }) as const),
      complete: jest.fn(async () => undefined),
    };
    const service = new WalletsService(
      walletsRepository as any,
      settlementService as any,
      walletTypesService as any,
      usersService as any,
      idempotencyService as any,
    );
    const created = { id: 'credit-wallet-1' };
    const found = {
      id: 'credit-wallet-1',
      balance: '400',
      walletType: {
        id: 'credit-type-1',
        code: 'CREDIT',
        currency: {
          code: 'USD',
          symbol: '$',
          symbolPosition: 'BEFORE',
          decimalPlaces: 2,
        },
      },
    };
    const manager = {
      create: jest.fn(() => created),
      save: jest.fn(async () => undefined),
      update: jest.fn(async () => undefined),
      findOne: jest.fn(async () => found),
      createQueryBuilder: jest.fn(() => ({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn(async () => options.repository),
      })),
    };
    return {
      service,
      manager,
      walletTypesService,
      usersService,
      idempotencyService,
    };
  }

  const baseRepository = {
    id: 'repo-1',
    userId: 'owner-1',
    closedAt: null,
    virtualAmount: '1000',
    walletType: { code: 'REPOSITORY', currencyId: 'currency-1' },
  };

  it('rejects granting from a wallet that is not a repository', async () => {
    const { service, manager } = buildGrantService({
      repository: {
        ...baseRepository,
        walletType: { code: 'BUY', currencyId: 'currency-1' },
      },
    });

    await expect(
      service.grantCredit(
        manager as any,
        'owner-1',
        {
          repositoryWalletId: 'repo-1',
          personnelPhoneNumber: '+15551234567',
          walletTypeId: 'credit-type-1',
          virtualAmount: 100,
        },
        'idem-key-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects granting from a closed repository', async () => {
    const { service, manager } = buildGrantService({
      repository: { ...baseRepository, closedAt: new Date() },
    });

    await expect(
      service.grantCredit(
        manager as any,
        'owner-1',
        {
          repositoryWalletId: 'repo-1',
          personnelPhoneNumber: '+15551234567',
          walletTypeId: 'credit-type-1',
          virtualAmount: 100,
        },
        'idem-key-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects granting into a non-CREDIT wallet type', async () => {
    const { service, manager } = buildGrantService({
      repository: baseRepository,
      creditWalletType: {
        id: 'gift-type-1',
        code: 'GIFT',
        currencyId: 'currency-1',
      },
    });

    await expect(
      service.grantCredit(
        manager as any,
        'owner-1',
        {
          repositoryWalletId: 'repo-1',
          personnelPhoneNumber: '+15551234567',
          walletTypeId: 'gift-type-1',
          virtualAmount: 100,
        },
        'idem-key-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a currency mismatch between the repository and the credit wallet type', async () => {
    const { service, manager } = buildGrantService({
      repository: baseRepository,
      creditWalletType: {
        id: 'credit-type-1',
        code: 'CREDIT',
        currencyId: 'currency-2',
      },
    });

    await expect(
      service.grantCredit(
        manager as any,
        'owner-1',
        {
          repositoryWalletId: 'repo-1',
          personnelPhoneNumber: '+15551234567',
          walletTypeId: 'credit-type-1',
          virtualAmount: 100,
        },
        'idem-key-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a grant that exceeds the repository's unallocated virtual pool", async () => {
    const { service, manager } = buildGrantService({
      repository: baseRepository,
    });

    await expect(
      service.grantCredit(
        manager as any,
        'owner-1',
        {
          repositoryWalletId: 'repo-1',
          personnelPhoneNumber: '+15551234567',
          walletTypeId: 'credit-type-1',
          virtualAmount: 5000,
        },
        'idem-key-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects when no account exists for the personnel phone number', async () => {
    const { service, manager } = buildGrantService({
      repository: baseRepository,
      personnel: null,
    });

    await expect(
      service.grantCredit(
        manager as any,
        'owner-1',
        {
          repositoryWalletId: 'repo-1',
          personnelPhoneNumber: '+15551234567',
          walletTypeId: 'credit-type-1',
          virtualAmount: 100,
        },
        'idem-key-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates the credit wallet, links it to the repository, and decrements the pool', async () => {
    const { service, manager } = buildGrantService({
      repository: baseRepository,
    });

    await service.grantCredit(
      manager as any,
      'owner-1',
      {
        repositoryWalletId: 'repo-1',
        personnelPhoneNumber: '+15551234567',
        walletTypeId: 'credit-type-1',
        virtualAmount: 400,
        nationalCode: '1234567890',
      },
      'idem-key-1',
    );

    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'personnel-1',
        walletTypeId: 'credit-type-1',
        virtualAmount: '400',
        nationalCode: '1234567890',
      }),
    );
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      'credit-wallet-1',
      { repositoryWalletId: 'repo-1', balance: '400' },
    );
    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'repo-1', {
      virtualAmount: '600',
    });
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'TRANSFER',
        fromWalletId: 'repo-1',
        toWalletId: 'credit-wallet-1',
        amount: '400',
        idempotencyKey: 'idem-key-1',
      }),
    );
  });

  it('replays the cached response instead of re-running the grant on a reused idempotency key', async () => {
    const { service, manager, idempotencyService } = buildGrantService({
      repository: baseRepository,
    });
    const cached = { id: 'credit-wallet-1', balance: '400' };
    (idempotencyService.claim as jest.Mock).mockResolvedValueOnce({
      replay: true,
      responseBody: cached,
    });

    const result = await service.grantCredit(
      manager as any,
      'owner-1',
      {
        repositoryWalletId: 'repo-1',
        personnelPhoneNumber: '+15551234567',
        walletTypeId: 'credit-type-1',
        virtualAmount: 400,
      },
      'idem-key-1',
    );

    expect(result).toBe(cached);
    expect(manager.create).not.toHaveBeenCalled();
  });
});
