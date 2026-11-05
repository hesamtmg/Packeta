import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { SettlementRailType } from '../../rail-settlements/entities/rail-settlement.entity';

// One payout method (interbank rail) of a merchant-style wallet type — see
// withdrawal-methods.ts for what each field means. Cross-field rules (no
// duplicate rails, a fee needs a fee repository, that repository must be a
// MERCHANT_REPOSITORY wallet in the type's currency) are checked in
// WalletTypesService.validateWithdrawalMethods.
export class WithdrawalMethodDto {
  @IsEnum(SettlementRailType)
  railType: SettlementRailType;

  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  feePercent?: number;

  // Flat fee per payout, in the type currency's minor units.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fixedFee?: number;

  @IsOptional()
  @IsUUID()
  feeRepositoryWalletId?: string;
}
