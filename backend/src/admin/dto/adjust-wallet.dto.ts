import { IsInt, IsString, MinLength } from 'class-validator';

// amount is signed minor units: positive credits the wallet, negative debits it.
export class AdjustWalletDto {
  @IsInt()
  amount: number;

  @IsString()
  @MinLength(3)
  reason: string;
}
