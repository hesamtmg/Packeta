import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';

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
  const service = new WalletsService(
    walletsRepository as any,
    settlementService as any,
  );
  return { service, walletsRepository };
}

describe('WalletsService.isCounterpartyAllowed', () => {
  const service = new WalletsService({} as any, {} as any);

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

describe('WalletsService.assertWithinTransactionLimits', () => {
  const service = new WalletsService({} as any, {} as any);

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
    const service = new WalletsService({} as any, {} as any);

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
