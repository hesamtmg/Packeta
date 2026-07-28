import { IsInt, IsUUID, Min } from 'class-validator';

// amount is expressed in minor units (e.g. cents) as a positive integer.
export class DepositDto {
  @IsUUID()
  walletId: string;

  @IsInt()
  @Min(1)
  amount: number;
}
