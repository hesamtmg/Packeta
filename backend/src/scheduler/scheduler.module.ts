import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { WalletsModule } from '../wallets/wallets.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { InstallmentsModule } from '../installments/installments.module';
import { PurchaseTimeoutSweepService } from './purchase-timeout-sweep.service';
import { AutoWithdrawSweepService } from './auto-withdraw-sweep.service';
import { InstallmentSweepService } from './installment-sweep.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    WalletsModule,
    TransactionsModule,
    InstallmentsModule,
  ],
  providers: [
    PurchaseTimeoutSweepService,
    AutoWithdrawSweepService,
    InstallmentSweepService,
  ],
})
export class SchedulerModule {}
