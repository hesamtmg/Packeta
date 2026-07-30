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
