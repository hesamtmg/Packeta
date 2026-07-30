import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletType } from './entities/wallet-type.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletTypesService } from './wallet-types.service';
import { WalletTypesController } from './wallet-types.controller';
import { AdminGuardModule } from '../auth/admin-guard.module';
import { CurrenciesModule } from '../currencies/currencies.module';

@Module({
  imports: [
    // Wallet is registered here too (not just in WalletsModule) purely for
    // WalletTypesService.delete's own-type-in-use check — pulling in
    // WalletsModule itself would be circular, since it already imports
    // WalletTypesModule for WalletTypesService.
    TypeOrmModule.forFeature([WalletType, Wallet]),
    AdminGuardModule,
    CurrenciesModule,
  ],
  controllers: [WalletTypesController],
  providers: [WalletTypesService],
  exports: [WalletTypesService],
})
export class WalletTypesModule {}
