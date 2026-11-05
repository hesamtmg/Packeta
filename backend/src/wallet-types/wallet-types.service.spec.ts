import { BadRequestException, ConflictException } from '@nestjs/common';
import { WalletTypesService } from './wallet-types.service';

function buildService(options: { walletCount: number }) {
  const type = { id: 'type-1', name: 'Rewards' };
  const walletTypesRepository = {
    findOne: jest.fn(async () => type),
    delete: jest.fn(async () => undefined),
  };
  const walletsRepository = {
    count: jest.fn(async () => options.walletCount),
  };
  const currenciesService = {};
  const service = new WalletTypesService(
    walletTypesRepository as any,
    walletsRepository as any,
    currenciesService as any,
  );
  return { service, walletTypesRepository, walletsRepository };
}

function buildServiceForAutoWithdraw(existingType: Record<string, unknown>) {
  const walletTypesRepository = {
    findOne: jest.fn(async () => existingType),
    create: jest.fn((data: Record<string, unknown>) => data),
    save: jest.fn(async (data: Record<string, unknown>) => data),
  };
  const walletsRepository = {};
  const currenciesService = {
    findByCode: jest.fn(async () => ({ id: 'currency-1', code: 'USD' })),
  };
  const service = new WalletTypesService(
    walletTypesRepository as any,
    walletsRepository as any,
    currenciesService as any,
  );
  return { service, walletTypesRepository };
}

describe('WalletTypesService.create — autoWithdrawTimes', () => {
  function build() {
    const walletTypesRepository = {
      findOne: jest.fn(async () => null),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn(async (data: Record<string, unknown>) => data),
    };
    const walletsRepository = {};
    const currenciesService = {
      findByCode: jest.fn(async () => ({ id: 'currency-1', code: 'USD' })),
    };
    const service = new WalletTypesService(
      walletTypesRepository as any,
      walletsRepository as any,
      currenciesService as any,
    );
    return { service, walletTypesRepository };
  }

  it('rejects autoWithdrawTimes when supportsAutoWithdraw is not set', async () => {
    const { service } = build();

    await expect(
      service.create({
        code: 'MERCHANT',
        name: 'Merchant',
        currencyCode: 'USD',
        autoWithdrawTimes: ['06:00', '12:00', '18:00'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts autoWithdrawTimes when supportsAutoWithdraw is true', async () => {
    const { service, walletTypesRepository } = build();

    const created = await service.create({
      code: 'MERCHANT',
      name: 'Merchant',
      currencyCode: 'USD',
      supportsAutoWithdraw: true,
      autoWithdrawTimes: ['06:00', '12:00', '18:00'],
    } as any);

    expect(created.autoWithdrawTimes).toEqual(['06:00', '12:00', '18:00']);
    expect(walletTypesRepository.save).toHaveBeenCalled();
  });

  it('allows creating with supportsAutoWithdraw true and no times set yet (empty array)', async () => {
    const { service, walletTypesRepository } = build();

    const created = await service.create({
      code: 'MERCHANT',
      name: 'Merchant',
      currencyCode: 'USD',
      supportsAutoWithdraw: true,
      autoWithdrawTimes: [],
    } as any);

    expect(created.autoWithdrawTimes).toBeNull();
    expect(walletTypesRepository.save).toHaveBeenCalled();
  });

  it('allows creating with supportsAutoWithdraw true and autoWithdrawTimes omitted entirely', async () => {
    const { service, walletTypesRepository } = build();

    const created = await service.create({
      code: 'MERCHANT',
      name: 'Merchant',
      currencyCode: 'USD',
      supportsAutoWithdraw: true,
    } as any);

    expect(created.autoWithdrawTimes).toBeNull();
    expect(walletTypesRepository.save).toHaveBeenCalled();
  });

  it('rejects a non-empty autoWithdrawTimes that is not exactly 3 entries', async () => {
    const { service } = build();

    await expect(
      service.create({
        code: 'MERCHANT',
        name: 'Merchant',
        currencyCode: 'USD',
        supportsAutoWithdraw: true,
        autoWithdrawTimes: ['06:00', '12:00'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating a REPOSITORY type with allowWithdraw true', async () => {
    const { service } = build();

    await expect(
      service.create({
        code: 'REPOSITORY',
        name: 'Repository',
        currencyCode: 'USD',
        allowWithdraw: true,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creating a REPOSITORY type with supportsAutoWithdraw true', async () => {
    const { service } = build();

    await expect(
      service.create({
        code: 'REPOSITORY',
        name: 'Repository',
        currencyCode: 'USD',
        supportsAutoWithdraw: true,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows creating a REPOSITORY type with allowWithdraw/supportsAutoWithdraw false', async () => {
    const { service, walletTypesRepository } = build();

    const created = await service.create({
      code: 'REPOSITORY',
      name: 'Repository',
      currencyCode: 'USD',
      allowWithdraw: false,
    } as any);

    expect(created).toBeDefined();
    expect(walletTypesRepository.save).toHaveBeenCalled();
  });

  it('defaults hasVirtualBalance to false when omitted', async () => {
    const { service } = build();

    const created = await service.create({
      code: 'MERCHANT',
      name: 'Merchant',
      currencyCode: 'USD',
    } as any);

    expect(created.hasVirtualBalance).toBe(false);
  });

  it('sets hasVirtualBalance true when requested', async () => {
    const { service } = build();

    const created = await service.create({
      code: 'REPOSITORY',
      name: 'Repository',
      currencyCode: 'USD',
      hasVirtualBalance: true,
    } as any);

    expect(created.hasVirtualBalance).toBe(true);
  });

  it('rejects creating a MERCHANT_REPOSITORY type with supportsAutoWithdraw true', async () => {
    const { service } = build();

    await expect(
      service.create({
        code: 'MERCHANT_REPOSITORY',
        name: 'Fee Repository',
        currencyCode: 'USD',
        allowWithdraw: true,
        supportsAutoWithdraw: true,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows creating a MERCHANT_REPOSITORY type with allowWithdraw true and supportsAutoWithdraw false', async () => {
    const { service, walletTypesRepository } = build();

    const created = await service.create({
      code: 'MERCHANT_REPOSITORY',
      name: 'Fee Repository',
      currencyCode: 'USD',
      allowWithdraw: true,
    } as any);

    expect(created).toBeDefined();
    expect(walletTypesRepository.save).toHaveBeenCalled();
  });
});

describe('WalletTypesService.create — fee/penalty/unblockFee sub-repositories', () => {
  function build(subRepositoryWallet: Record<string, unknown> | null) {
    const walletTypesRepository = {
      findOne: jest.fn(async () => null),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn(async (data: Record<string, unknown>) => data),
    };
    const walletsRepository = {
      findOne: jest.fn(async () => subRepositoryWallet),
    };
    const currenciesService = {
      findByCode: jest.fn(async () => ({ id: 'currency-1', code: 'USD' })),
    };
    const service = new WalletTypesService(
      walletTypesRepository as any,
      walletsRepository as any,
      currenciesService as any,
    );
    return { service, walletTypesRepository, walletsRepository };
  }

  it('rejects a feeRepositoryWalletId that does not exist', async () => {
    const { service } = build(null);

    await expect(
      service.create({
        code: 'CREDIT',
        name: 'Credit',
        currencyCode: 'USD',
        feeRepositoryWalletId: 'missing-wallet',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a feeRepositoryWalletId whose wallet is not MERCHANT_REPOSITORY-type', async () => {
    const { service } = build({
      walletType: { code: 'MERCHANT', currencyId: 'currency-1' },
    });

    await expect(
      service.create({
        code: 'CREDIT',
        name: 'Credit',
        currencyCode: 'USD',
        feeRepositoryWalletId: 'wallet-1',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a penaltyRepositoryWalletId in a different currency', async () => {
    const { service } = build({
      walletType: { code: 'MERCHANT_REPOSITORY', currencyId: 'other-currency' },
    });

    await expect(
      service.create({
        code: 'CREDIT',
        name: 'Credit',
        currencyCode: 'USD',
        penaltyRepositoryWalletId: 'wallet-1',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a valid same-currency MERCHANT_REPOSITORY wallet for all three fields', async () => {
    const { service, walletTypesRepository } = build({
      walletType: { code: 'MERCHANT_REPOSITORY', currencyId: 'currency-1' },
    });

    const created = await service.create({
      code: 'CREDIT',
      name: 'Credit',
      currencyCode: 'USD',
      feeRepositoryWalletId: 'wallet-1',
      penaltyRepositoryWalletId: 'wallet-2',
      unblockFeeRepositoryWalletId: 'wallet-3',
    } as any);

    expect(created.feeRepositoryWalletId).toBe('wallet-1');
    expect(created.penaltyRepositoryWalletId).toBe('wallet-2');
    expect(created.unblockFeeRepositoryWalletId).toBe('wallet-3');
    expect(walletTypesRepository.save).toHaveBeenCalled();
  });
});

describe('WalletTypesService.update — CREDIT cannot go negative', () => {
  it('rejects turning allowNegativeBalance on for a CREDIT type', async () => {
    const { service } = buildServiceForAutoWithdraw({
      id: 'type-1',
      code: 'CREDIT',
      supportsAutoWithdraw: false,
      autoWithdrawTimes: null,
      allowNegativeBalance: false,
      creditLimit: null,
    });

    await expect(
      service.update('type-1', {
        allowNegativeBalance: true,
        creditLimit: 1000,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('WalletTypesService.update — autoWithdrawTimes', () => {
  it('rejects a non-empty autoWithdrawTimes that is not exactly 3 entries', async () => {
    const { service } = buildServiceForAutoWithdraw({
      id: 'type-1',
      supportsAutoWithdraw: true,
      autoWithdrawTimes: null,
      allowNegativeBalance: false,
      creditLimit: null,
    });

    await expect(
      service.update('type-1', {
        autoWithdrawTimes: ['06:00', '12:00'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects autoWithdrawTimes when supportsAutoWithdraw is (effectively) false', async () => {
    const { service } = buildServiceForAutoWithdraw({
      id: 'type-1',
      supportsAutoWithdraw: false,
      autoWithdrawTimes: null,
      allowNegativeBalance: false,
      creditLimit: null,
    });

    await expect(
      service.update('type-1', {
        autoWithdrawTimes: ['06:00', '12:00', '18:00'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows setting autoWithdrawTimes together with supportsAutoWithdraw in the same update', async () => {
    const { service, walletTypesRepository } = buildServiceForAutoWithdraw({
      id: 'type-1',
      supportsAutoWithdraw: false,
      autoWithdrawTimes: null,
      allowNegativeBalance: false,
      creditLimit: null,
    });

    const updated = await service.update('type-1', {
      supportsAutoWithdraw: true,
      autoWithdrawTimes: ['06:00', '12:00', '18:00'],
    } as any);

    expect(updated.autoWithdrawTimes).toEqual(['06:00', '12:00', '18:00']);
    expect(walletTypesRepository.save).toHaveBeenCalled();
  });

  it('clears autoWithdrawTimes when supportsAutoWithdraw is turned off without explicitly clearing it', async () => {
    const { service } = buildServiceForAutoWithdraw({
      id: 'type-1',
      supportsAutoWithdraw: true,
      autoWithdrawTimes: ['06:00', '12:00', '18:00'],
      allowNegativeBalance: false,
      creditLimit: null,
    });

    const updated = await service.update('type-1', {
      supportsAutoWithdraw: false,
    } as any);

    expect(updated.autoWithdrawTimes).toBeNull();
  });

  it('clears autoWithdrawTimes back to null when given an empty array', async () => {
    const { service } = buildServiceForAutoWithdraw({
      id: 'type-1',
      supportsAutoWithdraw: true,
      autoWithdrawTimes: ['06:00', '12:00', '18:00'],
      allowNegativeBalance: false,
      creditLimit: null,
    });

    const updated = await service.update('type-1', {
      autoWithdrawTimes: [],
    } as any);

    expect(updated.autoWithdrawTimes).toBeNull();
  });

  it('rejects turning on allowWithdraw for a REPOSITORY type', async () => {
    const { service } = buildServiceForAutoWithdraw({
      id: 'type-1',
      code: 'REPOSITORY',
      supportsAutoWithdraw: false,
      autoWithdrawTimes: null,
      allowWithdraw: false,
      allowNegativeBalance: false,
      creditLimit: null,
    });

    await expect(
      service.update('type-1', { allowWithdraw: true } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects turning on supportsAutoWithdraw for a REPOSITORY type', async () => {
    const { service } = buildServiceForAutoWithdraw({
      id: 'type-1',
      code: 'REPOSITORY',
      supportsAutoWithdraw: false,
      autoWithdrawTimes: null,
      allowWithdraw: false,
      allowNegativeBalance: false,
      creditLimit: null,
    });

    await expect(
      service.update('type-1', { supportsAutoWithdraw: true } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('WalletTypesService.delete', () => {
  it('rejects deleting a wallet type that is still in use', async () => {
    const { service, walletTypesRepository } = buildService({
      walletCount: 3,
    });

    await expect(service.delete('type-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(walletTypesRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes a wallet type that no wallet uses', async () => {
    const { service, walletTypesRepository } = buildService({
      walletCount: 0,
    });

    await service.delete('type-1');

    expect(walletTypesRepository.delete).toHaveBeenCalledWith('type-1');
  });
});

describe('WalletTypesService — merchant withdrawal methods', () => {
  function build(feeRepositoryWallet: Record<string, unknown> | null) {
    const walletTypesRepository = {
      findOne: jest.fn(async () => null),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn(async (data: Record<string, unknown>) => data),
    };
    const walletsRepository = {
      findOne: jest.fn(async () => feeRepositoryWallet),
    };
    const currenciesService = {
      findByCode: jest.fn(async () => ({ id: 'currency-1', code: 'IRR' })),
    };
    const service = new WalletTypesService(
      walletTypesRepository as any,
      walletsRepository as any,
      currenciesService as any,
    );
    return { service, walletTypesRepository };
  }
  const merchantRepo = {
    walletType: { code: 'MERCHANT_REPOSITORY', currencyId: 'currency-1' },
  };
  const baseDto = {
    code: 'MERCHANT',
    name: 'Merchant',
    currencyCode: 'IRR',
    allowNegativeBalance: false,
    allowWithdraw: false,
    allowP2pOut: false,
    allowP2pIn: false,
    supportsAutoWithdraw: true,
  };

  it('stores each rail with its own fee and fee repository', async () => {
    const { service } = build(merchantRepo);

    const created = await service.create({
      ...baseDto,
      withdrawalMethods: [
        {
          railType: 'PAYA',
          enabled: true,
          feePercent: 0.5,
          fixedFee: 0,
          feeRepositoryWalletId: 'repo-1',
        },
        {
          railType: 'SATNA',
          enabled: true,
          fixedFee: 25000,
          feeRepositoryWalletId: 'repo-2',
        },
        { railType: 'POL_PAY', enabled: false },
      ],
    } as any);

    expect(created.withdrawalMethods).toEqual([
      {
        railType: 'PAYA',
        enabled: true,
        feePercent: '0.5',
        fixedFee: '0',
        feeRepositoryWalletId: 'repo-1',
      },
      {
        railType: 'SATNA',
        enabled: true,
        feePercent: '0',
        fixedFee: '25000',
        feeRepositoryWalletId: 'repo-2',
      },
      {
        railType: 'POL_PAY',
        enabled: false,
        feePercent: '0',
        fixedFee: '0',
        feeRepositoryWalletId: null,
      },
    ]);
  });

  it('rejects a rail that charges a fee without a fee repository', async () => {
    const { service } = build(merchantRepo);
    await expect(
      service.create({
        ...baseDto,
        withdrawalMethods: [{ railType: 'PAYA', enabled: true, feePercent: 1 }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a fee repository that is not a MERCHANT_REPOSITORY wallet', async () => {
    const { service } = build({
      walletType: { code: 'MERCHANT', currencyId: 'currency-1' },
    });
    await expect(
      service.create({
        ...baseDto,
        withdrawalMethods: [
          {
            railType: 'PAYA',
            enabled: true,
            fixedFee: 10,
            feeRepositoryWalletId: 'w-1',
          },
        ],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects the same rail listed twice', async () => {
    const { service } = build(merchantRepo);
    await expect(
      service.create({
        ...baseDto,
        withdrawalMethods: [
          { railType: 'PAYA', enabled: true },
          { railType: 'PAYA', enabled: false },
        ],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects withdrawal methods on a type without supportsAutoWithdraw', async () => {
    const { service } = build(merchantRepo);
    await expect(
      service.create({
        ...baseDto,
        supportsAutoWithdraw: false,
        withdrawalMethods: [{ railType: 'PAYA', enabled: true }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a config where every method is disabled', async () => {
    const { service } = build(merchantRepo);
    await expect(
      service.create({
        ...baseDto,
        withdrawalMethods: [{ railType: 'PAYA', enabled: false }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears the config on update with an empty list', async () => {
    const { service } = buildServiceForAutoWithdraw({
      id: 'type-1',
      code: 'MERCHANT',
      currencyId: 'currency-1',
      supportsAutoWithdraw: true,
      withdrawalMethods: [{ railType: 'PAYA', enabled: true }],
    });
    const updated = await service.update('type-1', {
      withdrawalMethods: [],
    } as any);
    expect(updated.withdrawalMethods).toBeNull();
  });
});

describe('WalletTypesService.update — clearing credit fee repositories', () => {
  it('clears a fee/penalty/unblock repository back to null when given an empty string', async () => {
    const { service } = buildServiceForAutoWithdraw({
      id: 'type-1',
      code: 'CREDIT',
      currencyId: 'currency-1',
      allowNegativeBalance: false,
      supportsAutoWithdraw: false,
      feeRepositoryWalletId: 'repo-1',
      penaltyRepositoryWalletId: 'repo-2',
      unblockFeeRepositoryWalletId: 'repo-3',
    });
    const updated = await service.update('type-1', {
      feeRepositoryWalletId: '',
      penaltyRepositoryWalletId: '',
      unblockFeeRepositoryWalletId: '',
    } as any);
    expect(updated.feeRepositoryWalletId).toBeNull();
    expect(updated.penaltyRepositoryWalletId).toBeNull();
    expect(updated.unblockFeeRepositoryWalletId).toBeNull();
  });
});
