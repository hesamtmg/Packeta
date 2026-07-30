import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { IBAN_REGEX } from '../../common/iban';

// A one-off settlement split supplied by the merchant when creating a
// specific charge (POST /transactions/purchase/charge), overriding the
// wallet's default for that purchase only. Unlike the wallet-level default,
// this may be a fixed amount (minor units) instead of a percentage, since
// the charge already fixes the total these need to sum to exactly.
export class SettlementSplitDto {
  @IsString()
  @Matches(IBAN_REGEX, { message: 'iban must look like a valid IBAN' })
  iban: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsIn(['PERCENT', 'FIXED'])
  type: 'PERCENT' | 'FIXED';

  // Percent (0-100] when type is PERCENT, minor-units integer amount when
  // type is FIXED.
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  value: number;
}
