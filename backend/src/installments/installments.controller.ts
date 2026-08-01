import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { InstallmentsService } from './installments.service';
import { serializeInstallment } from './installment.serializer';

@Controller('installments')
@UseGuards(JwtAuthGuard)
export class InstallmentsController {
  constructor(private readonly installmentsService: InstallmentsService) {}

  @Get()
  async listMine(@CurrentUser() user: AuthenticatedUser) {
    const installments = await this.installmentsService.findAllForUser(
      user.userId,
    );
    return installments.map(serializeInstallment);
  }

  @Get('wallet/:walletId')
  async listForWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Param('walletId') walletId: string,
  ) {
    const installments = await this.installmentsService.findForWallet(
      user.userId,
      walletId,
    );
    return installments.map(serializeInstallment);
  }
}
