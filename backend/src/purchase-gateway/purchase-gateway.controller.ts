import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PurchaseGatewayService } from './purchase-gateway.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { AttachWalletDto } from './dto/attach-wallet.dto';

// Unauthenticated by design — the customer using these has no Packeta
// session at all for a merchant-initiated charge. Identity comes from
// phone + OTP instead, scoped to one specific pending charge (authority).
@Controller('purchase-gateway')
export class PurchaseGatewayController {
  constructor(
    private readonly purchaseGatewayService: PurchaseGatewayService,
  ) {}

  @Get('charge/:authority/status')
  getStatus(@Param('authority') authority: string) {
    return this.purchaseGatewayService.getStatus(authority);
  }

  @Get('captcha')
  requestCaptcha() {
    return this.purchaseGatewayService.requestCaptcha();
  }

  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.purchaseGatewayService.requestOtp(
      dto.authority,
      dto.phoneNumber,
      dto.captchaId,
      dto.captchaAnswer,
    );
  }

  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.purchaseGatewayService.verifyOtp(dto.authority, dto.code);
  }

  @Post('attach-wallet')
  attachWallet(@Body() dto: AttachWalletDto) {
    return this.purchaseGatewayService.attachWallet(
      dto.authority,
      dto.sessionToken,
      dto.walletId,
    );
  }

  @Post('support-topup')
  confirmSupportTopUp(@Body() dto: AttachWalletDto) {
    return this.purchaseGatewayService.confirmSupportTopUp(
      dto.authority,
      dto.sessionToken,
      dto.walletId,
    );
  }
}
