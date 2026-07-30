import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { WalletTypesModule } from '../wallet-types/wallet-types.module';
import { SettlementModule } from '../settlement/settlement.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet]),
    WalletTypesModule,
    SettlementModule,
  ],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
