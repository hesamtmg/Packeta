import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { UpdateWalletDto } from './dto/update-wallet.dto';
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
    this.assertAutoWithdrawCapable(dto.autoWithdrawTimes, walletType);
    this.assertPurchaseInCapable(dto.purchaseTimeoutSeconds, walletType);
    this.assertAutoWithdrawCapable(
      dto.settlementAccounts,
      walletType,
      'settlement accounts',
    );
    this.assertPurchaseInCapable(dto.terminalId, walletType, 'a terminal id');
    this.assertPurchaseInCapable(
      dto.acceptorCode,
      walletType,
      'an acceptor code',
    );
    if (dto.settlementAccounts) {
      this.settlementService.validateWalletDefaults(dto.settlementAccounts);
    }

    const wallet = await this.dataSource.transaction((manager) =>
      this.walletsService.createForUser(manager, user.userId, walletType.id, {
        autoWithdrawTimes: dto.autoWithdrawTimes,
        purchaseTimeoutSeconds: dto.purchaseTimeoutSeconds,
        settlementAccounts: dto.settlementAccounts,
        restrictedCounterparties: dto.restrictedCounterparties,
        terminalId: dto.terminalId,
        acceptorCode: dto.acceptorCode,
      }),
    );
    const settlementAccounts = await this.settlementService.findForWallet(
      this.dataSource.manager,
      wallet.id,
    );
    return serializeWallet({ ...wallet, walletType }, settlementAccounts);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWalletDto,
  ) {
    const existing = await this.walletsService.getById(user.userId, id);
    const walletType = existing.walletType;

    this.assertAutoWithdrawCapable(dto.autoWithdrawTimes, walletType);
    if (dto.autoWithdrawTimes?.length && dto.autoWithdrawTimes.length !== 3) {
      throw new BadRequestException(
        'autoWithdrawTimes must be exactly 3 times, or an empty array to clear it',
      );
    }
    this.assertPurchaseInCapable(dto.purchaseTimeoutSeconds, walletType);
    this.assertAutoWithdrawCapable(
      dto.settlementAccounts,
      walletType,
      'settlement accounts',
    );
    this.assertPurchaseInCapable(dto.terminalId, walletType, 'a terminal id');
    this.assertPurchaseInCapable(
      dto.acceptorCode,
      walletType,
      'an acceptor code',
    );

    const wallet = await this.dataSource.transaction((manager) =>
      this.walletsService.updateForUser(manager, user.userId, id, {
        autoWithdrawTimes: dto.autoWithdrawTimes,
        purchaseTimeoutSeconds: dto.purchaseTimeoutSeconds,
        settlementAccounts: dto.settlementAccounts,
        restrictedCounterparties: dto.restrictedCounterparties,
        terminalId: dto.terminalId,
        acceptorCode: dto.acceptorCode,
      }),
    );
    const settlementAccounts = await this.settlementService.findForWallet(
      this.dataSource.manager,
      wallet.id,
    );
    return serializeWallet(wallet, settlementAccounts);
  }

  @Delete(':id')
  async close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const wallet = await this.walletsService.closeForUser(user.userId, id);
    return serializeWallet(wallet);
  }

  private assertAutoWithdrawCapable(
    value: unknown,
    walletType: { supportsAutoWithdraw: boolean },
    label = 'auto-withdraw scheduling',
  ): void {
    if (value !== undefined && !walletType.supportsAutoWithdraw) {
      throw new BadRequestException(
        label === 'settlement accounts'
          ? 'This wallet type does not support auto-withdraw scheduling, so settlement accounts are not applicable'
          : 'This wallet type does not support auto-withdraw scheduling',
      );
    }
  }

  private assertPurchaseInCapable(
    value: unknown,
    walletType: { allowPurchaseIn: boolean },
    label = 'a verification timeout',
  ): void {
    if (value !== undefined && !walletType.allowPurchaseIn) {
      throw new BadRequestException(
        `This wallet type does not accept purchases, so ${label} is not applicable`,
      );
    }
  }
}
