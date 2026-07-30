import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
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
import { SettlementService } from '../settlement/settlement.service';

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly walletTypesService: WalletTypesService,
    private readonly settlementService: SettlementService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const wallets = await this.walletsService.listForUser(user.userId);
    return Promise.all(
      wallets.map(async (wallet) => {
        const settlementAccounts = await this.settlementService.findForWallet(
          this.dataSource.manager,
          wallet.id,
        );
        return serializeWallet(wallet, settlementAccounts);
      }),
    );
  }

  @Get(':id')
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const wallet = await this.walletsService.getById(user.userId, id);
    const settlementAccounts = await this.settlementService.findForWallet(
      this.dataSource.manager,
      wallet.id,
    );
    return serializeWallet(wallet, settlementAccounts);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWalletDto,
  ) {
    const walletType = await this.walletTypesService.findById(dto.walletTypeId);

    if (dto.autoWithdrawTimes && !walletType.supportsAutoWithdraw) {
      throw new BadRequestException(
        'This wallet type does not support auto-withdraw scheduling',
      );
    }
    if (dto.purchaseTimeoutSeconds && !walletType.allowPurchaseIn) {
      throw new BadRequestException(
        'This wallet type does not accept purchases, so a verification timeout is not applicable',
      );
    }
    if (dto.settlementAccounts && !walletType.supportsAutoWithdraw) {
      throw new BadRequestException(
        'This wallet type does not support auto-withdraw scheduling, so settlement accounts are not applicable',
      );
    }
    if (dto.settlementAccounts) {
      this.settlementService.validateWalletDefaults(dto.settlementAccounts);
    }

    const wallet = await this.dataSource.transaction((manager) =>
      this.walletsService.createForUser(manager, user.userId, walletType.id, {
        autoWithdrawTimes: dto.autoWithdrawTimes,
        purchaseTimeoutSeconds: dto.purchaseTimeoutSeconds,
        settlementAccounts: dto.settlementAccounts,
      }),
    );
    const settlementAccounts = await this.settlementService.findForWallet(
      this.dataSource.manager,
      wallet.id,
    );
    return serializeWallet({ ...wallet, walletType }, settlementAccounts);
  }
}
