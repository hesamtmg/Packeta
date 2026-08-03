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
    const breakdowns =
      await this.installmentsService.getSpendBreakdownsFor(installments);
    return installments.map((i) =>
      serializeInstallment(i, breakdowns.get(i.id)),
    );
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
    const breakdowns =
      await this.installmentsService.getSpendBreakdownsFor(installments);
    return installments.map((i) =>
      serializeInstallment(i, breakdowns.get(i.id)),
    );
  }
}
