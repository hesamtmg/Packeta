import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

// amount is expressed in minor units (e.g. cents) as a positive integer.
// The merchant is identified by either their mobile number or one of their
// merchant wallets' terminal number — the receiving wallet is resolved
// server-side (see TransactionsService.resolvePurchaseMerchant), so the
// customer never sees or picks a wallet id belonging to someone else.
export class InitiatePurchaseDto {
  @IsUUID()
  fromWalletId: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  merchant: string;

  @IsInt()
  @Min(1)
  amount: number;
}
