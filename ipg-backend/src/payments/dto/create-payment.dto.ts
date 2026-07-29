import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class CreatePaymentDto {
  @IsString()
  merchantName: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  displayAmount: string;

  @IsUrl({ require_tld: false })
  callbackUrl: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  timeoutSeconds?: number;
}
