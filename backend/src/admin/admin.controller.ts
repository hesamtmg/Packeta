import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { AssignPanelRoleDto } from './dto/assign-panel-role.dto';
import { AdminCreateChargeDto } from './dto/admin-create-charge.dto';
import { AdminCreateWalletDto } from './dto/admin-create-wallet.dto';
import { normalizePhoneNumber } from '../common/phone-number';
import { SectionGuard } from './guards/section.guard';
import { RequireSection } from './decorators/require-section.decorator';
import { PanelRolesService } from '../panel-roles/panel-roles.service';
import { CreatePanelRoleDto } from '../panel-roles/dto/create-panel-role.dto';
import { UpdatePanelRoleDto } from '../panel-roles/dto/update-panel-role.dto';

function serializePanelRole(
  role: { id: string; name: string; permissions: string[] } | null,
) {
  if (!role) return null;
  return { id: role.id, name: role.name, permissions: role.permissions };
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// SectionGuard runs alongside AdminGuard on every route below — it only
// does something on routes carrying @RequireSection(...); everything else
// (including every route here without that decorator) stays reachable by
// any admin/super-admin exactly as before this permission system existed.
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard, SectionGuard)
export class AdminController {
  constructor(
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly walletTypesService: WalletTypesService,
    private readonly transactionsService: TransactionsService,
    private readonly installmentsService: InstallmentsService,
    private readonly loggingService: LoggingService,
    private readonly batchImportService: BatchImportService,
    private readonly panelRolesService: PanelRolesService,
    private readonly dataSource: DataSource,
  ) {}

  // Left ungated (no @RequireSection) — every admin/super-admin has always
  // been able to see who's on the platform; the customers/admins sections
  // gate the deeper per-user detail and management actions below instead.
  @Get('users')
  async listUsers() {
    const users = await this.usersService.findAll();
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      panelRole: serializePanelRole(user.panelRole),
      createdAt: user.createdAt,
    }));
  }

  @Get('users/:id')
  @RequireSection('customers', 'admins')
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
      panelRole: serializePanelRole(user.panelRole),
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
  @RequireSection('purchase')
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
  @RequireSection('purchase')
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
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      panelRole: serializePanelRole(user.panelRole),
    };
  }

  // Assigns (or clears, via panelRoleId: null) a named panel Role to a
  // regular ADMIN account. Gated by the "roles" section rather than
  // SuperAdminGuard — this is the capability a super-admin can hand out to
  // let someone else run the role-management page without making them a
  // super-admin (who'd bypass sections entirely). It still can't touch
  // account role (USER/ADMIN/SUPER_ADMIN) — that stays above, super-admin
  // only.
  @Patch('users/:id/panel-role')
  @RequireSection('roles')
  async assignPanelRole(
    @Param('id') id: string,
    @Body() dto: AssignPanelRoleDto,
  ) {
    const user = await this.usersService.setPanelRole(
      id,
      dto.panelRoleId ?? null,
    );
    return {
      id: user.id,
      email: user.email,
      panelRole: serializePanelRole(user.panelRole),
    };
  }

  // Left ungated, same reasoning as listUsers — anyone who can see the
  // panel users list should be able to see role names/labels too. Creating,
  // editing, deleting, and assigning roles is gated below by "roles".
  @Get('roles')
  listPanelRoles() {
    return this.panelRolesService.findAll();
  }

  @Post('roles')
  @RequireSection('roles')
  createPanelRole(@Body() dto: CreatePanelRoleDto) {
    return this.panelRolesService.create(dto);
  }

  @Patch('roles/:id')
  @RequireSection('roles')
  updatePanelRole(@Param('id') id: string, @Body() dto: UpdatePanelRoleDto) {
    return this.panelRolesService.update(id, dto);
  }

  @Delete('roles/:id')
  @RequireSection('roles')
  async deletePanelRole(@Param('id') id: string) {
    await this.panelRolesService.delete(id);
    return { deleted: true };
  }

  @Get('users/:id/transactions')
  @RequireSection('customers', 'admins')
  async getUserTransactions(@Param('id') id: string) {
    return this.transactionsService.getHistory(id);
  }

  // Left ungated, same reasoning as listUsers — the dashboard and reports
  // pages both need this raw list, and neither is section-gated.
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

  // Left ungated, same reasoning as listWallets.
  @Get('transactions')
  async listTransactions(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.transactionsService.listAll(parsedLimit);
  }

  @Get('transactions/:id')
  @RequireSection('transactions')
  async getTransaction(@Param('id') id: string) {
    return this.transactionsService.getByIdUnscoped(id);
  }

  // Every installment across every credit wallet, any customer — the panel
  // counterpart to a customer's own per-wallet installments view.
  @Get('installments')
  @RequireSection('installments')
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
  @RequireSection('installments')
  async listOverdueWallets() {
    return this.installmentsService.findBlockedWalletsSummary();
  }

  // Overdue-collection method 1 of 2: sends a real ZarinPal payment link
  // for the wallet's entire outstanding balance — see
  // TransactionsService.initiateOverdueCollectionZarinPal.
  @Post('installments/:walletId/collect/zarinpal')
  @RequireSection('installments')
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

  // Overdue-collection method 2 of 2: the repository absorbs the debt out
  // of its own real balance — see
  // TransactionsService.collectOverdueFromRepository. Since this moves real
  // money (unlike the old off-system "manual settlement" method it
  // absorbed), the admin must justify it with a description and may attach
  // a proof document, stored on disk purely as an audit reference — nothing
  // reads it back through the API.
  @Post('installments/:walletId/collect/repository')
  @RequireSection('installments')
  @UseInterceptors(
    FileInterceptor('document', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async collectOverdueRepository(
    @CurrentUser() user: AuthenticatedUser,
    @Param('walletId') walletId: string,
    @Body('description') description: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @UploadedFile() document?: Express.Multer.File,
  ) {
    if (!description?.trim()) {
      throw new BadRequestException(
        'A description justifying this write-off is required',
      );
    }
    const documentReference = document
      ? this.saveOverdueSettlementDocument(walletId, document)
      : null;
    return this.transactionsService.collectOverdueFromRepository(
      user.userId,
      walletId,
      description.trim(),
      documentReference,
      idempotencyKey,
    );
  }

  // Writes an uploaded settlement-proof document to a dedicated uploads
  // directory (created on first use) under a collision-proof name, and
  // returns that filename for the audit note — see collectOverdueRepository.
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
  @RequireSection('schedulerLogs')
  async listSchedulerLogs(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.loggingService.findRecent('SCHEDULER', parsedLimit);
  }

  @Post('wallets/:id/adjust')
  @RequireSection('wallets', 'customers')
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
  @RequireSection('customers')
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
  @RequireSection('wallets')
  async reopenWallet(@Param('id') walletId: string) {
    const wallet = await this.walletsService.reopenAsAdmin(walletId);
    return serializeWallet(wallet);
  }

  // Admin-scoped soft-close, e.g. from the role-management panel's embedded
  // wallet cards for another panel user — see WalletsService.closeAsAdmin.
  @Delete('wallets/:id')
  @RequireSection('wallets')
  async closeWallet(@Param('id') walletId: string) {
    const wallet = await this.walletsService.closeAsAdmin(walletId);
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
