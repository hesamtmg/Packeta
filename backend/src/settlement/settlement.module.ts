import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementSplit } from './entities/settlement-split.entity';
import { SettlementService } from './settlement.service';

@Module({
  imports: [TypeOrmModule.forFeature([SettlementSplit])],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
