import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class CreateWalletTypeDto {
  @IsString()
  @Matches(/^[A-Z0-9_]+$/, {
    message: 'code must be uppercase letters, numbers, or underscores',
  })
  code: string;

  @IsString()
  name: string;

  @IsString()
  currencyCode: string;

  @IsBoolean()
  allowNegativeBalance: boolean;

  // Required when allowNegativeBalance is true; the credit line's limit, in
  // minor units. Ignored otherwise.
  @IsOptional()
  @IsInt()
  @Min(0)
  creditLimit?: number;

  @IsBoolean()
  allowWithdraw: boolean;

  @IsBoolean()
  allowP2pOut: boolean;

  @IsBoolean()
  allowP2pIn: boolean;

  @IsOptional()
  @IsBoolean()
  supportsAutoWithdraw?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPurchaseOut?: boolean;

  @IsOptional()
  @IsBoolean()
  allowPurchaseIn?: boolean;
}
