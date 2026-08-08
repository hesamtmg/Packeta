import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { WidgetService } from './widget.service';
import { CaptchaService } from '../purchase-gateway/captcha.service';
import { CreateWidgetSessionDto } from './dto/create-widget-session.dto';
import { WidgetOtpRequestDto } from './dto/widget-otp-request.dto';
import { WidgetOtpVerifyDto } from './dto/widget-otp-verify.dto';
import { WidgetDepositDto } from './dto/widget-deposit.dto';
import { WidgetPayInstallmentDto } from './dto/widget-pay-installment.dto';

// Only POST /sessions needs a real Packeta account (the merchant's own,
// called server-to-server) — everything scoped by :token below is public by
// design, same reasoning as PurchaseGatewayController: the customer using it
// has no Packeta session of their own yet.
@Controller('widget')
@UseGuards(JwtAuthGuard)
export class WidgetController {
  constructor(
    private readonly widgetService: WidgetService,
    private readonly captchaService: CaptchaService,
  ) {}

  @Post('sessions')
  createSession(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWidgetSessionDto,
    @Ip() ip: string,
  ) {
    return this.widgetService.createSession(
      user.userId,
      dto.walletId,
      dto.phoneNumber,
      { ip },
    );
  }

  @Public()
  @Get('captcha')
  requestCaptcha() {
    return this.captchaService.generate();
  }

  @Public()
  @Get('sessions/:token/status')
  getStatus(@Param('token') token: string) {
    return this.widgetService.getStatus(token);
  }

  @Public()
  @Post('sessions/:token/otp/request')
  requestOtp(@Param('token') token: string, @Body() dto: WidgetOtpRequestDto) {
    return this.widgetService.requestOtp(
      token,
      dto.phoneNumber,
      dto.captchaId,
      dto.captchaAnswer,
    );
  }

  @Public()
  @Post('sessions/:token/otp/verify')
  verifyOtp(@Param('token') token: string, @Body() dto: WidgetOtpVerifyDto) {
    return this.widgetService.verifyOtp(token, dto.code);
  }

  @Public()
  @Post('sessions/:token/authenticate')
  authenticate(@Param('token') token: string) {
    return this.widgetService.authenticate(token);
  }

  @Public()
  @Get('sessions/:token/wallets')
  getWallets(@Param('token') token: string) {
    return this.widgetService.getWallets(token);
  }

  @Public()
  @Get('sessions/:token/transactions')
  getTransactions(
    @Param('token') token: string,
    @Query('walletId') walletId?: string,
  ) {
    return this.widgetService.getTransactions(token, walletId);
  }

  @Public()
  @Get('sessions/:token/transactions/:transactionId')
  getTransaction(
    @Param('token') token: string,
    @Param('transactionId') transactionId: string,
  ) {
    return this.widgetService.getTransaction(token, transactionId);
  }

  @Public()
  @Get('sessions/:token/installments')
  getInstallments(@Param('token') token: string) {
    return this.widgetService.getInstallments(token);
  }

  @Public()
  @Post('sessions/:token/deposit')
  deposit(
    @Param('token') token: string,
    @Body() dto: WidgetDepositDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.widgetService.deposit(token, dto, idempotencyKey);
  }

  @Public()
  @Post('sessions/:token/installments/:installmentId/pay')
  payInstallment(
    @Param('token') token: string,
    @Param('installmentId') installmentId: string,
    @Body() dto: WidgetPayInstallmentDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.widgetService.payInstallment(
      token,
      installmentId,
      dto.returnUrl,
      idempotencyKey,
    );
  }
}
