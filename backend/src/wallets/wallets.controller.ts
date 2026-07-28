import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { WalletsService } from './wallets.service';

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('me')
  async getMyWallet(@CurrentUser() user: AuthenticatedUser) {
    const wallet = await this.walletsService.getByUserId(user.userId);
    return { id: wallet.id, balance: wallet.balance };
  }
}
