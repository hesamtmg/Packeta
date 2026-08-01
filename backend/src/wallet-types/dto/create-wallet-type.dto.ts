import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
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

  // Only meaningful when supportsAutoWithdraw is true: exactly 3 "HH:MM"
  // (24h, server-local) times every wallet of this type sweeps out at.
  @IsOptional()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
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

  // Credit-line fields (repository/credit wallet feature). All optional and
  // only meaningful on the CREDIT-style types this feature applies to.
  @IsOptional()
  @IsInt()
  @Min(0)
  virtualAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  installmentDate?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  paymentDeadlineDate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  fee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  penalty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unblockFee?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'nationalCode must be 10 digits' })
  nationalCode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  installmentCount?: number;
}
