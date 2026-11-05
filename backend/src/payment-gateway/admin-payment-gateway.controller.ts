import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { LoggingService } from '../logging/logging.service';
import { PaymentGatewayService } from './payment-gateway.service';
import { SetPaymentGatewayDto } from './dto/set-payment-gateway.dto';

// Super-admin only: picks which PSP (ZarinPal or Sadad) every new real-money
// payment goes through. Payments already in flight keep verifying with the
// gateway that created them (Transaction.ipgProvider).
@Controller('admin/payment-gateway')
@UseGuards(JwtAuthGuard, AdminGuard, SuperAdminGuard)
export class AdminPaymentGatewayController {
  constructor(
    private readonly paymentGatewayService: PaymentGatewayService,
    private readonly loggingService: LoggingService,
  ) {}

  @Get()
  get() {
    return this.paymentGatewayService.getSetting();
  }

  @Put()
  async set(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: SetPaymentGatewayDto,
  ) {
    const previous = await this.paymentGatewayService.getActiveProvider();
    await this.paymentGatewayService.setActiveProvider(
      dto.provider,
      admin.userId,
    );
    await this.loggingService.log({
      category: 'AUTH',
      action: 'PAYMENT_GATEWAY_CHANGED',
      success: true,
      userId: admin.userId,
      metadata: { from: previous, to: dto.provider },
    });
    return this.paymentGatewayService.getSetting();
  }
}
