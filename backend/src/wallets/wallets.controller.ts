import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
import { WalletTypeCode } from '../wallet-types/entities/wallet-type.entity';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { GrantCreditDto } from './dto/grant-credit.dto';
import { serializeWallet } from './wallet.serializer';
import { SettlementService } from '../settlement/settlement.service';
import { CustomerActionGuard } from '../admin/guards/customer-action.guard';
import { RequireCustomerAction } from '../admin/decorators/require-customer-action.decorator';

@Controller('wallets')
@UseGuards(JwtAuthGuard, CustomerActionGuard)
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
  @RequireCustomerAction('addWallet')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWalletDto,
  ) {
    const walletType = await this.walletTypesService.findById(dto.walletTypeId);
    if (walletType.code === WalletTypeCode.CREDIT) {
      throw new BadRequestException(
        'CREDIT wallets can only be created by a repository owner via POST /wallets/credit-grant',
      );
    }
    if (walletType.code === WalletTypeCode.SUPPORT) {
      throw new BadRequestException(
        'SUPPORT wallets are provisioned automatically when a credit purchase needs a top-up',
      );
    }
    this.assertPurchaseInCapable(dto.purchaseTimeoutSeconds, walletType);
    this.assertAutoWithdrawCapable(
      dto.settlementAccounts,
      walletType,
      'settlement accounts',
    );
    this.assertAutoWithdrawCapable(
      dto.railType,
      walletType,
      'a withdrawal rail',
    );
    this.assertAutoWithdrawCapable(
      dto.railScheduleTimes,
      walletType,
      'a withdrawal rail schedule',
    );
    this.assertPurchaseInCapable(dto.terminalId, walletType, 'a terminal id');
    this.assertPurchaseInCapable(
      dto.acceptorCode,
      walletType,
      'an acceptor code',
    );
    this.assertPurchaseInCapable(dto.storeName, walletType, 'a store name');
    this.assertPurchaseInCapable(dto.storeSite, walletType, 'a store site');
    this.assertPurchaseInCapable(dto.allowedIps, walletType, 'an IP allowlist');
    this.assertPurchaseInCapable(dto.callbackUrl, walletType, 'a callback URL');
    this.assertPurchaseInCapable(dto.category, walletType, 'a category');
    this.assertPurchaseInCapable(dto.subCategory, walletType, 'a sub-category');
    this.assertVirtualBalanceCapable(dto.virtualAmount, walletType);
    if (dto.settlementAccounts) {
      this.settlementService.validateWalletDefaults(dto.settlementAccounts);
    }

    const wallet = await this.dataSource.transaction((manager) =>
      this.walletsService.createForUser(manager, user.userId, walletType.id, {
        name: dto.name,
        purchaseTimeoutSeconds: dto.purchaseTimeoutSeconds,
        settlementAccounts: dto.settlementAccounts,
        restrictedCounterparties: dto.restrictedCounterparties,
        terminalId: dto.terminalId,
        acceptorCode: dto.acceptorCode,
        minTransactionAmount: dto.minTransactionAmount,
        maxTransactionAmount: dto.maxTransactionAmount,
        storeName: dto.storeName,
        storeSite: dto.storeSite,
        allowedIps: dto.allowedIps,
        callbackUrl: dto.callbackUrl,
        category: dto.category,
        subCategory: dto.subCategory,
        virtualAmount: dto.virtualAmount,
        nationalCode: dto.nationalCode,
        railType: dto.railType,
        railScheduleTimes: dto.railScheduleTimes,
      }),
    );
    const settlementAccounts = await this.settlementService.findForWallet(
      this.dataSource.manager,
      wallet.id,
    );
    return serializeWallet({ ...wallet, walletType }, settlementAccounts);
  }

  // A repository owner splits off some of their unallocated virtual pool
  // into a brand-new CREDIT wallet for an existing user, looked up by phone —
  // the only way a CREDIT wallet can be created (see the CREDIT guard in
  // create() above).
  @Post('credit-grant')
  async grantCredit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GrantCreditDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.dataSource.transaction((manager) =>
      this.walletsService.grantCredit(
        manager,
        user.userId,
        dto,
        idempotencyKey,
      ),
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateWalletDto,
  ) {
    const existing = await this.walletsService.getById(user.userId, id);
    const walletType = existing.walletType;

    this.assertPurchaseInCapable(dto.purchaseTimeoutSeconds, walletType);
    this.assertAutoWithdrawCapable(
      dto.settlementAccounts,
      walletType,
      'settlement accounts',
    );
    this.assertAutoWithdrawCapable(
      dto.railType,
      walletType,
      'a withdrawal rail',
    );
    this.assertAutoWithdrawCapable(
      dto.railScheduleTimes,
      walletType,
      'a withdrawal rail schedule',
    );
    this.assertPurchaseInCapable(dto.terminalId, walletType, 'a terminal id');
    this.assertPurchaseInCapable(
      dto.acceptorCode,
      walletType,
      'an acceptor code',
    );
    this.assertPurchaseInCapable(dto.storeName, walletType, 'a store name');
    this.assertPurchaseInCapable(dto.storeSite, walletType, 'a store site');
    this.assertPurchaseInCapable(dto.allowedIps, walletType, 'an IP allowlist');
    this.assertPurchaseInCapable(dto.callbackUrl, walletType, 'a callback URL');
    this.assertPurchaseInCapable(dto.category, walletType, 'a category');
    this.assertPurchaseInCapable(dto.subCategory, walletType, 'a sub-category');
    this.assertVirtualBalanceCapable(dto.virtualAmount, walletType);

    const wallet = await this.dataSource.transaction((manager) =>
      this.walletsService.updateForUser(manager, user.userId, id, {
        name: dto.name,
        purchaseTimeoutSeconds: dto.purchaseTimeoutSeconds,
        settlementAccounts: dto.settlementAccounts,
        restrictedCounterparties: dto.restrictedCounterparties,
        terminalId: dto.terminalId,
        acceptorCode: dto.acceptorCode,
        minTransactionAmount: dto.minTransactionAmount,
        maxTransactionAmount: dto.maxTransactionAmount,
        storeName: dto.storeName,
        storeSite: dto.storeSite,
        allowedIps: dto.allowedIps,
        callbackUrl: dto.callbackUrl,
        category: dto.category,
        subCategory: dto.subCategory,
        virtualAmount: dto.virtualAmount,
        nationalCode: dto.nationalCode,
        railType: dto.railType,
        railScheduleTimes: dto.railScheduleTimes,
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

  private assertVirtualBalanceCapable(
    value: unknown,
    walletType: { hasVirtualBalance: boolean },
  ): void {
    if (value !== undefined && !walletType.hasVirtualBalance) {
      throw new BadRequestException(
        'This wallet type does not support a virtual balance',
      );
    }
  }
}
