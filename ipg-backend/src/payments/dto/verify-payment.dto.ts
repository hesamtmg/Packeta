import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class VerifyPaymentDto {
  // If provided, must match the amount the intent was created with —
  // catches a merchant verifying against a tampered/stale reference.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount?: number;
}
