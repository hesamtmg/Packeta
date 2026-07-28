import { IsInt, Min } from 'class-validator';

// amount is expressed in minor units (e.g. cents) as a positive integer.
export class WithdrawDto {
  @IsInt()
  @Min(1)
  amount: number;
}
