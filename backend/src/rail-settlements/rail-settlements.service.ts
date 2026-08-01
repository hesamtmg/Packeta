import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  RailSettlement,
  RailSettlementStatus,
  SettlementRailType,
} from './entities/rail-settlement.entity';

@Injectable()
export class RailSettlementsService {
  constructor(
    @InjectRepository(RailSettlement)
    private readonly railSettlementsRepository: Repository<RailSettlement>,
  ) {}

  // Called from inside TransactionsService.sweepAutoWithdraw's rail-aware
  // branch, once per generated WITHDRAW slice — records the rail metadata a
  // plain Transaction row has no fields for. transactionId is already known
  // at call time (the WITHDRAW was created and saved first), so this is a
  // single insert rather than a two-step create-then-link.
  async createForSweep(
    manager: EntityManager,
    input: {
      walletId: string;
      railType: SettlementRailType;
      amount: string;
      destinationIban: string | null;
      label: string | null;
      transactionId: string;
      scheduledFor: Date;
    },
  ): Promise<RailSettlement> {
    const settlement = manager.create(RailSettlement, {
      walletId: input.walletId,
      railType: input.railType,
      amount: input.amount,
      destinationIban: input.destinationIban,
      label: input.label,
      status: RailSettlementStatus.COMPLETED,
      scheduledFor: input.scheduledFor,
      processedAt: new Date(),
      transactionId: input.transactionId,
    });
    return manager.save(settlement);
  }

  // Every rail settlement across every wallet the caller owns — the
  // customer-facing audit trail of "what left, over which rail, and when."
  async findAllForUser(userId: string): Promise<RailSettlement[]> {
    return this.railSettlementsRepository
      .createQueryBuilder('settlement')
      .innerJoin('wallets', 'wallet', 'wallet."id" = settlement."walletId"')
      .where('wallet."userId" = :userId', { userId })
      .orderBy('settlement.scheduledFor', 'DESC')
      .getMany();
  }
}
