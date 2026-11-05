import { IsEnum } from 'class-validator';
import { PaymentGatewayProvider } from '../payment-gateway-provider';

export class SetPaymentGatewayDto {
  @IsEnum(PaymentGatewayProvider)
  provider: PaymentGatewayProvider;
}
