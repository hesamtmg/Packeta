import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletTypesService } from '../wallet-types/wallet-types.service';
import { WalletTypeCode } from '../wallet-types/entities/wallet-type.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { InstallmentsService } from '../installments/installments.service';
import { LoggingService } from '../logging/logging.service';
import { BatchImportService } from './batch-import.service';
import { serializeWallet } from '../wallets/wallet.serializer';
import { serializeInstallment } from '../installments/installment.serializer';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { AdminCreateChargeDto } from './dto/admin-create-charge.dto';
import { AdminCreateWalletDto } from './dto/admin-create-wallet.dto';
import { normalizePhoneNumber } from '../common/phone-number';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly walletTypesService: WalletTypesService,
    private readonly transactionsService: TransactionsService,
    private readonly installmentsService: InstallmentsService,
    private readonly loggingService: LoggingService,
    private readonly batchImportService: BatchImportService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('users')
  async listUsers() {
    const users = await this.usersService.findAll();
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      createdAt: user.createdAt,
    }));
  }

  @Get('users/:id')
  async getUser(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const wallets = await this.walletsService.listForUser(id);
    return {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      createdAt: user.createdAt,
      wallets: wallets.map((wallet) => serializeWallet(wallet)),
    };
  }

  // Looks a merchant up by phone number and lists which of their wallets
  // can receive purchases — backs the "create a charge on this merchant's
  // behalf" card, since an admin (unlike the merchant themselves) needs to
  // see and choose among all of that merchant's eligible wallets rather
  // than having one auto-picked for a single currency.
  @Get('merchants/by-phone')
  async getMerchantByPhone(@Query('phone') phone: string) {
    if (!phone) {
      throw new BadRequestException('phone query parameter is required');
    }
    const merchant = await this.usersService.findByPhoneNumber(
      normalizePhoneNumber(phone),
    );
    if (!merchant) {
      throw new NotFoundException('No account found with that phone number');
    }
    const wallets = await this.walletsService.listMerchantEligibleWallets(
      merchant.id,
    );
    return {
      id: merchant.id,
      email: merchant.email,
      phoneNumber: merchant.phoneNumber,
      wallets: wallets.map((wallet) => serializeWallet(wallet)),
    };
  }

  // Creates a charge/payment link on behalf of a merchant the admin looked
  // up by phone — the merchant never has to be logged in for this.
  @Post('purchase/charge')
  async createCharge(
    @Body() dto: AdminCreateChargeDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const wallet = await this.walletsService.getByIdUnscoped(dto.walletId);
    if (!wallet.walletType.allowPurchaseIn || wallet.closedAt) {
      throw new BadRequestException('That wallet cannot receive purchases');
    }
    return this.transactionsService.initiateCharge(
      wallet.userId,
      dto.amount,
      wallet.walletType.currency.code,
      idempotencyKey,
      dto.language,
      undefined,
      wallet.id,
    );
  }

  // Only super-admins can promote/demote — a regular admin can view and
  // manage everything else on this controller but not change anyone's role.
  @Patch('users/:id/role')
  @UseGuards(SuperAdminGuard)
  async updateUserRole(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    if (id === admin.userId) {
      throw new BadRequestException(
        'Cannot change your own admin role from the panel',
      );
    }
    const user = await this.usersService.setRole(id, dto.role);
    return { id: user.id, email: user.email, role: user.role };
  }

  @Get('users/:id/transactions')
  async getUserTransactions(@Param('id') id: string) {
    return this.transactionsService.getHistory(id);
  }

  @Get('wallets')
  async listWallets() {
    const wallets = await this.walletsService.listAll();
    return wallets.map((wallet) => ({
      ...serializeWallet(wallet),
      ownerId: wallet.user.id,
      ownerEmail: wallet.user.email,
      ownerPhoneNumber: wallet.user.phoneNumber,
    }));
  }

  @Get('transactions')
  async listTransactions(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.transactionsService.listAll(parsedLimit);
  }

  @Get('transactions/:id')
  async getTransaction(@Param('id') id: string) {
    return this.transactionsService.getByIdUnscoped(id);
  }

  // Every installment across every credit wallet, any customer — the panel
  // counterpart to a customer's own per-wallet installments view.
  @Get('installments')
  async listInstallments() {
    const installments = await this.installmentsService.findAll();
    return installments.map((installment) => ({
      ...serializeInstallment(installment),
      ownerEmail: installment.wallet.user.email,
      ownerPhoneNumber: installment.wallet.user.phoneNumber,
      walletTypeName: installment.wallet.walletType.name,
      currency: installment.wallet.walletType.currency,
    }));
  }

  // Every credit wallet currently blocked for missed payments (see
  // InstallmentsService.applyOverduePenalties), with the full amount owed
  // — the admin panel's queue for the three overdue-collection actions
  // below.
  @Get('installments/overdue')
  async listOverdueWallets() {
    return this.installmentsService.findBlockedWalletsSummary();
  }

  // Overdue-collection method 1 of 3: sends a real ZarinPal payment link
  // for the wallet's entire outstanding balance — see
  // TransactionsService.initiateOverdueCollectionZarinPal.
  @Post('installments/:walletId/collect/zarinpal')
  async collectOverdueZarinPal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('walletId') walletId: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionsService.initiateOverdueCollectionZarinPal(
      user.userId,
      walletId,
      idempotencyKey,
    );
  }

  // Overdue-collection method 2 of 3: the repository absorbs the debt out
  // of its own real balance — see
  // TransactionsService.collectOverdueFromRepository.
  @Post('installments/:walletId/collect/repository')
  async collectOverdueRepository(
    @CurrentUser() user: AuthenticatedUser,
    @Param('walletId') walletId: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionsService.collectOverdueFromRepository(
      user.userId,
      walletId,
      idempotencyKey,
    );
  }

  // Overdue-collection method 3 of 3: the admin confirms the debt was
  // settled outside the system (bank transfer, cash, ...), attaching a
  // description and an optional proof document — see
  // TransactionsService.collectOverdueManually. The document is stored on
  // disk purely as an audit reference; nothing reads it back through the
  // API.
  @Post('installments/:walletId/collect/manual')
  @UseInterceptors(
    FileInterceptor('document', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async collectOverdueManual(
    @CurrentUser() user: AuthenticatedUser,
    @Param('walletId') walletId: string,
    @Body('description') description: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @UploadedFile() document?: Express.Multer.File,
  ) {
    if (!description?.trim()) {
      throw new BadRequestException(
        'A description of how this was settled is required',
      );
    }
    const documentReference = document
      ? this.saveOverdueSettlementDocument(walletId, document)
      : null;
    return this.transactionsService.collectOverdueManually(
      user.userId,
      walletId,
      description.trim(),
      documentReference,
      idempotencyKey,
    );
  }

  // Writes an uploaded settlement-proof document to a dedicated uploads
  // directory (created on first use) under a collision-proof name, and
  // returns that filename for the audit note — see collectOverdueManual.
  private saveOverdueSettlementDocument(
    walletId: string,
    document: Express.Multer.File,
  ): string {
    const uploadsDir = join(
      __dirname,
      '..',
      '..',
      'uploads',
      'overdue-settlements',
    );
    mkdirSync(uploadsDir, { recursive: true });
    const safeName = document.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${walletId}-${randomUUID()}-${safeName}`;
    writeFileSync(join(uploadsDir, filename), document.buffer);
    return filename;
  }

  // Recent scheduler runs (installment generation/penalties, auto-withdraw
  // and rail-settlement sweeps, purchase-timeout reversals) — the panel's
  // window into background jobs that otherwise only show up in server logs.
  @Get('scheduler-logs')
  async listSchedulerLogs(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.loggingService.findRecent('SCHEDULER', parsedLimit);
  }

  @Post('wallets/:id/adjust')
  adjustWallet(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') walletId: string,
    @Body() dto: AdjustWalletDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionsService.adjust(
      admin.userId,
      walletId,
      dto.amount,
      dto.reason,
      idempotencyKey,
    );
  }

  // Admin panel's "Add wallet" action on a customer — a narrower version of
  // the self-service POST /wallets (see AdminCreateWalletDto), for quickly
  // provisioning a customer a wallet without them doing it themselves.
  @Post('customers/:userId/wallets')
  async createWalletForCustomer(
    @Param('userId') userId: string,
    @Body() dto: AdminCreateWalletDto,
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
    if (dto.virtualAmount !== undefined && !walletType.hasVirtualBalance) {
      throw new BadRequestException(
        'This wallet type does not support a virtual balance',
      );
    }
    const wallet = await this.dataSource.transaction((manager) =>
      this.walletsService.createForUser(manager, userId, walletType.id, {
        virtualAmount: dto.virtualAmount,
        nationalCode: dto.nationalCode,
      }),
    );
    return serializeWallet({ ...wallet, walletType });
  }

  // Reopens a wallet a customer (or a previous admin action) closed —
  // counterpart to the customer's own DELETE /wallets/:id soft-close.
  @Post('wallets/:id/reopen')
  async reopenWallet(@Param('id') walletId: string) {
    const wallet = await this.walletsService.reopenAsAdmin(walletId);
    return serializeWallet(wallet);
  }

  // Bulk onboarding: an admin uploads a spreadsheet of customers/wallets
  // instead of creating them one at a time — see BatchImportService for the
  // expected columns. Only super-admins, same bar as anything else that
  // creates accounts or reshapes wallets in bulk rather than one at a time.
  @Post('customers/batch')
  @UseGuards(SuperAdminGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async batchImportCustomers(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.batchImportService.importCustomers(file.buffer);
  }

  @Post('wallets/batch')
  @UseGuards(SuperAdminGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async batchImportWallets(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.batchImportService.importWallets(file.buffer);
  }
}
