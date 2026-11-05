import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IpgModule } from '../ipg/ipg.module';
import { AdminGuardModule } from '../auth/admin-guard.module';
import { LoggingModule } from '../logging/logging.module';
import { PlatformSetting } from './entities/platform-setting.entity';
import { PaymentGatewayService } from './payment-gateway.service';
import { SadadReturnController } from './sadad-return.controller';
import { AdminPaymentGatewayController } from './admin-payment-gateway.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlatformSetting]),
    IpgModule,
    AdminGuardModule,
    LoggingModule,
  ],
  controllers: [SadadReturnController, AdminPaymentGatewayController],
  providers: [PaymentGatewayService],
  exports: [PaymentGatewayService],
})
export class PaymentGatewayModule {}
