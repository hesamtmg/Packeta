import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { WalletTypesModule } from '../wallet-types/wallet-types.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { AdminGuardModule } from '../auth/admin-guard.module';
import { AdminController } from './admin.controller';
import { BatchImportService } from './batch-import.service';

@Module({
  imports: [
    UsersModule,
    WalletsModule,
    WalletTypesModule,
    TransactionsModule,
    AdminGuardModule,
  ],
  controllers: [AdminController],
  providers: [BatchImportService],
})
export class AdminModule {}
