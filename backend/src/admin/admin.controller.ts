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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionsService } from '../transactions/transactions.service';
import { serializeWallet } from '../wallets/wallet.serializer';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Get('users')
  async listUsers() {
    const users = await this.usersService.findAll();
    return users.map((user) => ({
      id: user.id,
      email: user.email,
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
      role: user.role,
      createdAt: user.createdAt,
      wallets: wallets.map((wallet) => serializeWallet(wallet)),
    };
  }

  @Patch('users/:id/role')
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
    }));
  }

  @Get('transactions')
  async listTransactions(@Query('limit') limit?: string) {
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    return this.transactionsService.listAll(parsedLimit);
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
}
