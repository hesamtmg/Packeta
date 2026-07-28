import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletType } from './entities/wallet-type.entity';
import { WalletTypesService } from './wallet-types.service';
import { WalletTypesController } from './wallet-types.controller';
import { AdminGuardModule } from '../auth/admin-guard.module';
import { CurrenciesModule } from '../currencies/currencies.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WalletType]),
    AdminGuardModule,
    CurrenciesModule,
  ],
  controllers: [WalletTypesController],
  providers: [WalletTypesService],
  exports: [WalletTypesService],
})
export class WalletTypesModule {}
