import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  RailSettlement,
  RailSettlementStatus,
  SettlementRailType,
} from './entities/rail-settlement.entity';
import { RailProviderClient } from './providers/rail-provider.interface';
import { PolPayClientService } from './providers/polpay-client.service';
import { PayaClientService } from './providers/paya-client.service';
import { SatnaClientService } from './providers/satna-client.service';
import { BankTransferClientService } from './providers/bank-transfer-client.service';

@Injectable()
export class RailSettlementsService {
  constructor(
    @InjectRepository(RailSettlement)
    private readonly railSettlementsRepository: Repository<RailSettlement>,
    private readonly polPayClient: PolPayClientService,
    private readonly payaClient: PayaClientService,
    private readonly satnaClient: SatnaClientService,
    private readonly bankTransferClient: BankTransferClientService,
  ) {}

  private clientFor(railType: SettlementRailType): RailProviderClient {
    switch (railType) {
      case SettlementRailType.POL_PAY:
        return this.polPayClient;
      case SettlementRailType.PAYA:
        return this.payaClient;
      case SettlementRailType.SATNA:
        return this.satnaClient;
      case SettlementRailType.BANK_TRANSFER:
        return this.bankTransferClient;
    }
  }

  // Called from inside TransactionsService.withdraw/sweepAutoWithdraw's
  // rail-aware branches, once per generated WITHDRAW slice — records the
  // rail metadata a plain Transaction row has no fields for, then calls out
  // to that rail's (currently mocked) provider and persists whatever it
  // answers with. transactionId is already known at call time (the WITHDRAW
  // was created and saved first), so this is a single insert rather than a
  // two-step create-then-link.
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
      status: RailSettlementStatus.PENDING,
      scheduledFor: input.scheduledFor,
      processedAt: null,
      transactionId: input.transactionId,
    });
    await manager.save(settlement);

    const result = await this.clientFor(input.railType).submit({
      railSettlementId: settlement.id,
      walletId: input.walletId,
      amount: input.amount,
      destinationIban: input.destinationIban,
      label: input.label,
    });

    settlement.status = result.success
      ? RailSettlementStatus.COMPLETED
      : RailSettlementStatus.FAILED;
    settlement.processedAt = new Date();
    settlement.providerReference = result.providerReference;
    settlement.providerResponse = result.raw;
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
