import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WidgetSession } from './entities/widget-session.entity';
import { WalletsModule } from '../wallets/wallets.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { InstallmentsModule } from '../installments/installments.module';
import { WidgetService } from './widget.service';
import { WidgetController } from './widget.controller';
import { OtpService } from '../purchase-gateway/otp.service';
import { CaptchaService } from '../purchase-gateway/captcha.service';

// Reuses PurchaseGatewayModule's OtpService/CaptchaService classes directly
// (both have zero constructor dependencies) rather than a copy — same OTP
// mechanics, fresh in-memory state, no coupling to PurchaseGatewayModule
// needed. TransactionsModule/InstallmentsModule back the account widget's
// transactions/installments/deposit/pay-installment endpoints — neither
// imports WidgetModule back, so no circular dependency.
@Module({
  imports: [
    TypeOrmModule.forFeature([WidgetSession]),
    WalletsModule,
    TransactionsModule,
    InstallmentsModule,
  ],
  controllers: [WidgetController],
  providers: [WidgetService, OtpService, CaptchaService],
})
export class WidgetModule {}
