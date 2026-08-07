import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

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

  // Whether wallets of this type may carry a manually-set virtual balance at
  // creation (see WalletType.hasVirtualBalance).
  @IsOptional()
  @IsBoolean()
  hasVirtualBalance?: boolean;

  // Hides wallets of this type from a customer's own wallets/transactions
  // lists (see WalletType.hiddenFromCustomer).
  @IsOptional()
  @IsBoolean()
  hiddenFromCustomer?: boolean;

  // Credit-line fields (repository/credit wallet feature). All optional and
  // only meaningful on the CREDIT-style types this feature applies to —
  // the shared billing rules; the actual virtualAmount granted and the
  // holder's nationalCode are per-wallet (see UpdateWalletDto).
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
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  feePercent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  penaltyPercentPerDay?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unblockFee?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  installmentCount?: number;

  // How many days an installment may sit OVERDUE before the wallet is
  // blocked and the admin notified (see WalletType.overdueDaysBeforeBlock).
  @IsOptional()
  @IsInt()
  @Min(1)
  overdueDaysBeforeBlock?: number;

  // Where an installment repayment's fee/penalty/unblock-fee slices are
  // routed instead of the credit wallet's own backing repository — each
  // must be an existing MERCHANT_REPOSITORY-type wallet in this type's
  // currency (see WalletTypesService.validateSubRepository).
  @IsOptional()
  @IsUUID()
  feeRepositoryWalletId?: string;

  @IsOptional()
  @IsUUID()
  penaltyRepositoryWalletId?: string;

  @IsOptional()
  @IsUUID()
  unblockFeeRepositoryWalletId?: string;
}
