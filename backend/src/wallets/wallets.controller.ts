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
import { serializeWallet } from './wallet.serializer';

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
    return wallets.map(serializeWallet);
  }

  @Get(':id')
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const wallet = await this.walletsService.getById(user.userId, id);
    return serializeWallet(wallet);
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
    return serializeWallet({ ...wallet, walletType });
  }
}
