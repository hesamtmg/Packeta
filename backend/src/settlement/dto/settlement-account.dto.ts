import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IBAN_REGEX } from '../../common/iban';

// A merchant wallet's default settlement destination, set at wallet
// creation — see CreateWalletDto.settlementAccounts. Always a percentage:
// a fixed amount can't be validated against a purchase whose amount isn't
// known yet at this point (that's what per-charge overrides are for).
export class SettlementAccountDto {
  @IsString()
  @Matches(IBAN_REGEX, { message: 'iban must look like a valid IBAN' })
  iban: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100)
  percent: number;
}
