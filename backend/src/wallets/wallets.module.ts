import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { WalletTypesModule } from '../wallet-types/wallet-types.module';
import { SettlementModule } from '../settlement/settlement.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { CustomerActionGuard } from '../admin/guards/customer-action.guard';
import { GlModule } from '../gl/gl.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet]),
    WalletTypesModule,
    SettlementModule,
    IdempotencyModule,
    GlModule,
  ],
  controllers: [WalletsController],
  providers: [WalletsService, CustomerActionGuard],
  exports: [WalletsService],
})
export class WalletsModule {}
