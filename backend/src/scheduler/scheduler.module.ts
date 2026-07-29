import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WalletsModule } from '../wallets/wallets.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { PurchaseTimeoutSweepService } from './purchase-timeout-sweep.service';
import { AutoWithdrawSweepService } from './auto-withdraw-sweep.service';

@Module({
  imports: [ScheduleModule.forRoot(), WalletsModule, TransactionsModule],
  providers: [PurchaseTimeoutSweepService, AutoWithdrawSweepService],
})
export class SchedulerModule {}
