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
