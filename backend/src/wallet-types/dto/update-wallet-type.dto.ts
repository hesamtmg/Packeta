import { IsBoolean, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

// Same "empty clears" convention as UpdateWalletDto: send an explicit empty
// array to clear autoWithdrawTimes back to unset. Non-empty must still be
// exactly 3 times — checked in the service alongside the supportsAutoWithdraw
// cross-check, since "empty is fine, non-empty must be exactly 3" isn't
// expressible with a single array-size decorator.
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

  @IsOptional()
  @IsBoolean()
  supportsAutoWithdraw?: boolean;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true })
  autoWithdrawTimes?: string[];

  @IsOptional()
  @IsBoolean()
  allowPurchaseOut?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPurchaseIn?: boolean;

  @IsOptional()
  @IsBoolean()
  depositable?: boolean;
}
