import { IsInt, IsString, Min } from 'class-validator';

// amount is expressed in minor units (e.g. cents) as a positive integer.
// No customer or wallet is chosen yet — that happens at the IPG, after the
// customer identifies themselves by phone + OTP and picks one of their own
// eligible wallets. The merchant's own destination wallet is resolved
// server-side from currencyCode, same as any other purchase.
export class InitiateChargeDto {
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  currencyCode: string;
}
