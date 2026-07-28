import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { WalletsService } from './wallets.service';
import { WalletTypesService } from '../wallet-types/wallet-types.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { Wallet } from './entities/wallet.entity';

function serialize(wallet: Wallet) {
  return {
    id: wallet.id,
    balance: wallet.balance,
    walletType: {
      code: wallet.walletType.code,
      name: wallet.walletType.name,
      allowNegativeBalance: wallet.walletType.allowNegativeBalance,
      creditLimit: wallet.walletType.creditLimit,
      allowWithdraw: wallet.walletType.allowWithdraw,
      allowP2pOut: wallet.walletType.allowP2pOut,
      allowP2pIn: wallet.walletType.allowP2pIn,
    },
    createdAt: wallet.createdAt,
  };
}

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly walletTypesService: WalletTypesService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const wallets = await this.walletsService.listForUser(user.userId);
    return wallets.map(serialize);
  }

  @Get(':id')
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const wallet = await this.walletsService.getById(user.userId, id);
    return serialize(wallet);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWalletDto,
  ) {
    const walletType = await this.walletTypesService.findByCode(
      dto.walletTypeCode,
    );
    const wallet = await this.dataSource.transaction((manager) =>
      this.walletsService.createForUser(manager, user.userId, walletType.id),
    );
    return serialize({ ...wallet, walletType });
  }
}
