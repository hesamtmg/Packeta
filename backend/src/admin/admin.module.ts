import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { AdminGuardModule } from '../auth/admin-guard.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [UsersModule, WalletsModule, TransactionsModule, AdminGuardModule],
  controllers: [AdminController],
})
export class AdminModule {}
