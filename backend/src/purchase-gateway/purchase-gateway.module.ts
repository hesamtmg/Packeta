import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletsModule } from '../wallets/wallets.module';
import { PurchaseGatewayService } from './purchase-gateway.service';
import { PurchaseGatewayController } from './purchase-gateway.controller';
import { OtpService } from './otp.service';
import { CaptchaService } from './captcha.service';
import { GlModule } from '../gl/gl.module';

@Module({
  imports: [TransactionsModule, WalletsModule, GlModule],
  controllers: [PurchaseGatewayController],
  providers: [PurchaseGatewayService, OtpService, CaptchaService],
})
export class PurchaseGatewayModule {}
