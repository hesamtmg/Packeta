import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { WalletsModule } from '../wallets/wallets.module';
import { PurchaseGatewayService } from './purchase-gateway.service';
import { PurchaseGatewayController } from './purchase-gateway.controller';
import { OtpService } from './otp.service';
import { CaptchaService } from './captcha.service';

@Module({
  imports: [TransactionsModule, WalletsModule],
  controllers: [PurchaseGatewayController],
  providers: [PurchaseGatewayService, OtpService, CaptchaService],
})
export class PurchaseGatewayModule {}
