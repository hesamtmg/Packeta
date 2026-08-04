import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { WalletTypesModule } from '../wallet-types/wallet-types.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { InstallmentsModule } from '../installments/installments.module';
import { LoggingModule } from '../logging/logging.module';
import { AdminGuardModule } from '../auth/admin-guard.module';
import { PanelRolesModule } from '../panel-roles/panel-roles.module';
import { AdminController } from './admin.controller';
import { BatchImportService } from './batch-import.service';
import { SectionGuard } from './guards/section.guard';

@Module({
  imports: [
    UsersModule,
    WalletsModule,
    WalletTypesModule,
    TransactionsModule,
    InstallmentsModule,
    LoggingModule,
    AdminGuardModule,
    PanelRolesModule,
  ],
  controllers: [AdminController],
  providers: [BatchImportService, SectionGuard],
})
export class AdminModule {}
