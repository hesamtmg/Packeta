import { IsOptional, IsString } from 'class-validator';

export class ReverseTransactionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
