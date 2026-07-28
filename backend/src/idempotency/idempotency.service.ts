import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { EntityManager, QueryFailedError } from 'typeorm';
import {
  IdempotencyKey,
  IdempotencyStatus,
} from './entities/idempotency-key.entity';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export type ClaimResult =
  { replay: true; responseBody: Record<string, any> } | { replay: false };

@Injectable()
export class IdempotencyService {
  hashPayload(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  // Must run inside the same DB transaction as the operation it guards. On a
  // fresh key it inserts an IN_PROGRESS row and returns replay:false so the
  // caller proceeds; `complete()` must be called before commit. On a reused
  // key it either replays the cached response or rejects if the payload
  // differs or the earlier request is still in flight.
  async claim(
    manager: EntityManager,
    params: {
      key: string;
      userId: string;
      endpoint: string;
      payload: unknown;
    },
  ): Promise<ClaimResult> {
    const requestHash = this.hashPayload(params.payload);

    // A unique-violation on the insert below aborts the rest of this DB
    // transaction unless it happened inside its own savepoint, so wrap the
    // speculative insert and roll back just that statement on conflict.
    const queryRunner = manager.queryRunner!;
    await queryRunner.query('SAVEPOINT idempotency_claim');
    try {
      await manager.insert(IdempotencyKey, {
        key: params.key,
        userId: params.userId,
        endpoint: params.endpoint,
        requestHash,
        status: IdempotencyStatus.IN_PROGRESS,
      });
      return { replay: false };
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
      await queryRunner.query('ROLLBACK TO SAVEPOINT idempotency_claim');
    }

    const existing = await manager.findOne(IdempotencyKey, {
      where: { key: params.key },
    });

    if (
      !existing ||
      existing.userId !== params.userId ||
      existing.endpoint !== params.endpoint ||
      existing.requestHash !== requestHash
    ) {
      throw new ConflictException(
        'Idempotency key was already used for a different request',
      );
    }

    if (existing.status === IdempotencyStatus.IN_PROGRESS) {
      throw new ConflictException(
        'A request with this idempotency key is already being processed',
      );
    }

    return { replay: true, responseBody: existing.responseBody ?? {} };
  }

  async complete(
    manager: EntityManager,
    key: string,
    responseBody: Record<string, any>,
  ): Promise<void> {
    await manager.update(IdempotencyKey, key, {
      status: IdempotencyStatus.COMPLETED,
      responseBody,
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as unknown as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
    );
  }
}
