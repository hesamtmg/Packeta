import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

// The admin already picked which of the merchant's wallets should receive
// this charge (see AdminController.getMerchantByPhone) — no currencyCode
// needed here, the wallet's own currency is authoritative.
export class AdminCreateChargeDto {
  @IsUUID()
  walletId: string;

  @IsInt()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsIn(['en', 'fa'])
  language?: 'en' | 'fa';
}
