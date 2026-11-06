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
  Put,
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
import {
  assertAutoWithdrawCapable,
  assertPurchaseInCapable,
  assertRailEnabled,
  assertUpdateApplicable,
  assertVirtualBalanceCapable,
  toUpdateOptions,
} from './wallet-field-rules';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { GrantCreditDto } from './dto/grant-credit.dto';
import { ReorderWalletsDto } from './dto/reorder-wallets.dto';
import { serializeWallet } from './wallet.serializer';
import { SettlementService } from '../settlement/settlement.service';
import { CustomerActionGuard } from '../admin/guards/customer-action.guard';
import { RequireCustomerAction } from '../admin/decorators/require-customer-action.decorator';
import { LedgerService } from '../gl/ledger.service';

@Controller('wallets')
@UseGuards(JwtAuthGuard, CustomerActionGuard)
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly walletTypesService: WalletTypesService,
    private readonly settlementService: SettlementService,
    private readonly ledgerService: LedgerService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const wallets = (await this.walletsService.listForUser(user.userId)).filter(
      (wallet) => !wallet.walletType.hiddenFromCustomer,
    );
    const balances = await this.ledgerService.getWalletBalances(
      this.dataSource.manager,
      wallets.map((wallet) => wallet.id),
    );
    return Promise.all(
      wallets.map(async (wallet) => {
        const settlementAccounts = await this.settlementService.findForWallet(
          this.dataSource.manager,
          wallet.id,
        );
        return serializeWallet(
          wallet,
          (balances.get(wallet.id) ?? 0n).toString(),
          settlementAccounts,
        );
      }),
    );
  }

  // Saves the customer's own arrangement of their wallet list.
  @Put('order')
  async reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderWalletsDto,
  ) {
    await this.walletsService.reorderForUser(user.userId, dto.walletIds);
    return this.list(user);
  }

  // Marks one of the customer's open wallets as their default.
  @Post(':id/default')
  async setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const wallet = await this.walletsService.setDefaultForUser(user.userId, id);
    const [settlementAccounts, balance] = await Promise.all([
      this.settlementService.findForWallet(this.dataSource.manager, wallet.id),
      this.ledgerService.getWalletBalance(this.dataSource.manager, wallet.id),
    ]);
    return serializeWallet(wallet, balance.toString(), settlementAccounts);
  }

  @Get(':id')
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const wallet = await this.walletsService.getById(user.userId, id);
    const [settlementAccounts, balance] = await Promise.all([
      this.settlementService.findForWallet(this.dataSource.manager, wallet.id),
      this.ledgerService.getWalletBalance(this.dataSource.manager, wallet.id),
    ]);
    return serializeWallet(wallet, balance.toString(), settlementAccounts);
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
    assertPurchaseInCapable(dto.purchaseTimeoutSeconds, walletType);
    assertAutoWithdrawCapable(
      dto.settlementAccounts,
      walletType,
      'settlement accounts',
    );
    assertAutoWithdrawCapable(dto.railType, walletType, 'a withdrawal rail');
    assertAutoWithdrawCapable(
      dto.railScheduleTimes,
      walletType,
      'a withdrawal rail schedule',
    );
    assertRailEnabled(dto.railType, walletType);
    assertPurchaseInCapable(dto.terminalId, walletType, 'a terminal id');
    assertPurchaseInCapable(dto.acceptorCode, walletType, 'an acceptor code');
    assertPurchaseInCapable(dto.storeName, walletType, 'a store name');
    assertPurchaseInCapable(dto.storeSite, walletType, 'a store site');
    assertPurchaseInCapable(dto.allowedIps, walletType, 'an IP allowlist');
    assertPurchaseInCapable(dto.callbackUrl, walletType, 'a callback URL');
    assertPurchaseInCapable(dto.category, walletType, 'a category');
    assertPurchaseInCapable(dto.subCategory, walletType, 'a sub-category');
    assertVirtualBalanceCapable(dto.virtualAmount, walletType);
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
    return serializeWallet({ ...wallet, walletType }, '0', settlementAccounts);
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

    assertUpdateApplicable(dto, walletType);

    const wallet = await this.dataSource.transaction((manager) =>
      this.walletsService.updateForUser(
        manager,
        user.userId,
        id,
        toUpdateOptions(dto),
      ),
    );
    const [settlementAccounts, balance] = await Promise.all([
      this.settlementService.findForWallet(this.dataSource.manager, wallet.id),
      this.ledgerService.getWalletBalance(this.dataSource.manager, wallet.id),
    ]);
    return serializeWallet(wallet, balance.toString(), settlementAccounts);
  }

  @Delete(':id')
  async close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const wallet = await this.walletsService.closeForUser(user.userId, id);
    return serializeWallet(wallet, '0');
  }
}
