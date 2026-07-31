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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionsService } from '../transactions/transactions.service';
import { BatchImportService } from './batch-import.service';
import { serializeWallet } from '../wallets/wallet.serializer';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { AdminCreateChargeDto } from './dto/admin-create-charge.dto';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly transactionsService: TransactionsService,
    private readonly batchImportService: BatchImportService,
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
    const merchant = await this.usersService.findByPhoneNumber(phone);
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
