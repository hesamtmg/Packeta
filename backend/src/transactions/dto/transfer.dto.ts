import { IsEmail, IsInt, IsUUID, Min } from 'class-validator';

// amount is expressed in minor units (e.g. cents) as a positive integer.
// The recipient's destination wallet is resolved server-side (their oldest
// eligible wallet) rather than chosen by the sender, so another user's
// wallet list is never exposed to the caller.
export class TransferDto {
  @IsUUID()
  fromWalletId: string;

  @IsEmail()
  toEmail: string;

  @IsInt()
  @Min(1)
  amount: number;
}
