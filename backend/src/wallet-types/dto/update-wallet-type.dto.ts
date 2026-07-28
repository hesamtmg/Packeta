import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateWalletTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  allowNegativeBalance?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  creditLimit?: number;

  @IsOptional()
  @IsBoolean()
  allowWithdraw?: boolean;

  @IsOptional()
  @IsBoolean()
  allowP2pOut?: boolean;

  @IsOptional()
  @IsBoolean()
  allowP2pIn?: boolean;
}
