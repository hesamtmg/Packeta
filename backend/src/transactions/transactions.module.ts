import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from './entities/transaction.entity';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { WalletsModule } from '../wallets/wallets.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { LoggingModule } from '../logging/logging.module';
import { IpgModule } from '../ipg/ipg.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    WalletsModule,
    IdempotencyModule,
    LoggingModule,
    IpgModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
