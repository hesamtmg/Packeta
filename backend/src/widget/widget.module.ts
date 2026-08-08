import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WidgetSession } from './entities/widget-session.entity';
import { WalletsModule } from '../wallets/wallets.module';
import { WidgetService } from './widget.service';
import { WidgetController } from './widget.controller';
import { OtpService } from '../purchase-gateway/otp.service';
import { CaptchaService } from '../purchase-gateway/captcha.service';

// Reuses PurchaseGatewayModule's OtpService/CaptchaService classes directly
// (both have zero constructor dependencies) rather than a copy — same OTP
// mechanics, fresh in-memory state, no coupling to PurchaseGatewayModule
// needed.
@Module({
  imports: [TypeOrmModule.forFeature([WidgetSession]), WalletsModule],
  controllers: [WidgetController],
  providers: [WidgetService, OtpService, CaptchaService],
})
export class WidgetModule {}
