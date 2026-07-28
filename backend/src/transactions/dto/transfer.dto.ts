import { IsEmail, IsInt, Min } from 'class-validator';

// amount is expressed in minor units (e.g. cents) as a positive integer.
export class TransferDto {
  @IsEmail()
  toEmail: string;

  @IsInt()
  @Min(1)
  amount: number;
}
