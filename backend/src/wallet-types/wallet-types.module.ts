import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletType } from './entities/wallet-type.entity';
import { WalletTypesService } from './wallet-types.service';
import { WalletTypesController } from './wallet-types.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WalletType])],
  controllers: [WalletTypesController],
  providers: [WalletTypesService],
  exports: [WalletTypesService],
})
export class WalletTypesModule {}
