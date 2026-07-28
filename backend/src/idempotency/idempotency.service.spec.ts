import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyStatus } from './entities/idempotency-key.entity';

function uniqueViolation(): QueryFailedError {
  const error = new QueryFailedError('insert', [], new Error('duplicate key'));
  (error as unknown as { code: string }).code = '23505';
  return error;
}

function buildManager(insert: jest.Mock, findOne: jest.Mock) {
  return {
    insert,
    findOne,
    queryRunner: { query: jest.fn().mockResolvedValue(undefined) },
  } as any;
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  beforeEach(() => {
    service = new IdempotencyService();
  });

  it('claims a fresh key by inserting an IN_PROGRESS row', async () => {
    const insert = jest.fn().mockResolvedValue(undefined);
    const manager = buildManager(insert, jest.fn());

    const result = await service.claim(manager, {
      key: 'key-1',
      userId: 'user-1',
      endpoint: 'deposit',
      payload: { amount: 100 },
    });

    expect(result).toEqual({ replay: false });
    expect(insert).toHaveBeenCalled();
  });

  it('replays the cached response when the same request repeats', async () => {
    const insert = jest.fn().mockRejectedValue(uniqueViolation());
    const findOne = jest.fn().mockResolvedValue({
      key: 'key-1',
      userId: 'user-1',
      endpoint: 'deposit',
      requestHash: service.hashPayload({ amount: 100 }),
      status: IdempotencyStatus.COMPLETED,
      responseBody: { balance: '100' },
    });
    const manager = buildManager(insert, findOne);

    const result = await service.claim(manager, {
      key: 'key-1',
      userId: 'user-1',
      endpoint: 'deposit',
      payload: { amount: 100 },
    });

    expect(result).toEqual({ replay: true, responseBody: { balance: '100' } });
    expect(manager.queryRunner.query).toHaveBeenCalledWith(
      'ROLLBACK TO SAVEPOINT idempotency_claim',
    );
  });

  it('rejects when the same key is reused with a different payload', async () => {
    const insert = jest.fn().mockRejectedValue(uniqueViolation());
    const findOne = jest.fn().mockResolvedValue({
      key: 'key-1',
      userId: 'user-1',
      endpoint: 'deposit',
      requestHash: service.hashPayload({ amount: 999 }),
      status: IdempotencyStatus.COMPLETED,
      responseBody: {},
    });
    const manager = buildManager(insert, findOne);

    await expect(
      service.claim(manager, {
        key: 'key-1',
        userId: 'user-1',
        endpoint: 'deposit',
        payload: { amount: 100 },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a concurrent duplicate that is still in flight', async () => {
    const insert = jest.fn().mockRejectedValue(uniqueViolation());
    const findOne = jest.fn().mockResolvedValue({
      key: 'key-1',
      userId: 'user-1',
      endpoint: 'deposit',
      requestHash: service.hashPayload({ amount: 100 }),
      status: IdempotencyStatus.IN_PROGRESS,
      responseBody: null,
    });
    const manager = buildManager(insert, findOne);

    await expect(
      service.claim(manager, {
        key: 'key-1',
        userId: 'user-1',
        endpoint: 'deposit',
        payload: { amount: 100 },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
