import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RailSettlement } from './entities/rail-settlement.entity';
import { RailSettlementsService } from './rail-settlements.service';
import { RailSettlementsController } from './rail-settlements.controller';
import { PolPayClientService } from './providers/polpay-client.service';
import { PayaClientService } from './providers/paya-client.service';
import { SatnaClientService } from './providers/satna-client.service';
import { BankTransferClientService } from './providers/bank-transfer-client.service';

@Module({
  imports: [TypeOrmModule.forFeature([RailSettlement])],
  controllers: [RailSettlementsController],
  providers: [
    RailSettlementsService,
    PolPayClientService,
    PayaClientService,
    SatnaClientService,
    BankTransferClientService,
  ],
  exports: [RailSettlementsService],
})
export class RailSettlementsModule {}
