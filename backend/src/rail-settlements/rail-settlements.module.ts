import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RailSettlement } from './entities/rail-settlement.entity';
import { RailSettlementsService } from './rail-settlements.service';
import { RailSettlementsController } from './rail-settlements.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RailSettlement])],
  controllers: [RailSettlementsController],
  providers: [RailSettlementsService],
  exports: [RailSettlementsService],
})
export class RailSettlementsModule {}
