import { IsEmail, IsInt, IsUUID, Min } from 'class-validator';

// amount is expressed in minor units (e.g. cents) as a positive integer.
// The merchant's destination wallet is resolved server-side (their oldest
// eligible wallet), same as a P2P transfer — the customer never sees or
// picks a specific wallet id belonging to someone else.
export class InitiatePurchaseDto {
  @IsUUID()
  fromWalletId: string;

  @IsEmail()
  toEmail: string;

  @IsInt()
  @Min(1)
  amount: number;
}
