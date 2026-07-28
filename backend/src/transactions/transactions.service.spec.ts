import { UnprocessableEntityException } from '@nestjs/common';
import { TransactionsService } from './transactions.service';

function buildService(overrides: {
  senderWallet: { id: string; balance: string };
  recipientWallet: { id: string; balance: string };
}) {
  const { senderWallet, recipientWallet } = overrides;
  const lockCalls: string[] = [];

  const walletsService = {
    getByUserId: jest.fn(async (userId: string) =>
      userId === 'sender' ? senderWallet : recipientWallet,
    ),
    lockByUserId: jest.fn(),
    lockById: jest.fn(async (_manager: unknown, id: string) => {
      lockCalls.push(id);
      return id === senderWallet.id ? senderWallet : recipientWallet;
    }),
  };

  const idempotencyService = {
    claim: jest.fn().mockResolvedValue({ replay: false }),
    complete: jest.fn().mockResolvedValue(undefined),
  };

  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };

  const manager = {
    findOne: jest.fn().mockResolvedValue({ id: 'recipient-user-id' }),
    update: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((_entity: unknown, data: unknown) => data),
    save: jest.fn(async (data: any) => ({ ...data, id: 'tx-1' })),
  };

  const dataSource = {
    transaction: jest.fn(async (work: (manager: unknown) => Promise<unknown>) =>
      work(manager),
    ),
  };

  const service = new TransactionsService(
    dataSource as any,
    walletsService as any,
    idempotencyService as any,
    loggingService as any,
    {} as any,
  );

  return { service, lockCalls };
}

describe('TransactionsService.transfer', () => {
  it('locks wallets in ascending id order regardless of transfer direction', async () => {
    const senderWallet = { id: 'wallet-b', balance: '500' };
    const recipientWallet = { id: 'wallet-a', balance: '0' };
    const { service, lockCalls } = buildService({
      senderWallet,
      recipientWallet,
    });

    await service.transfer('sender', 'recipient@example.com', 100, 'idem-1');

    expect(lockCalls).toEqual(['wallet-a', 'wallet-b']);
  });

  it('rejects a transfer that exceeds the sender balance', async () => {
    const senderWallet = { id: 'wallet-a', balance: '50' };
    const recipientWallet = { id: 'wallet-b', balance: '0' };
    const { service } = buildService({ senderWallet, recipientWallet });

    await expect(
      service.transfer('sender', 'recipient@example.com', 100, 'idem-2'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
