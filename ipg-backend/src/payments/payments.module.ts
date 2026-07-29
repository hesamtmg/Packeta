import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentIntent } from './entities/payment-intent.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentIntent])],
  providers: [PaymentsService],
  controllers: [PaymentsController],
})
export class PaymentsModule {}
