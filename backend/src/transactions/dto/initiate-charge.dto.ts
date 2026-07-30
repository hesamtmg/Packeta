import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { SettlementSplitDto } from '../../settlement/dto/settlement-split.dto';

// amount is expressed in minor units (e.g. cents) as a positive integer.
// No customer or wallet is chosen yet — that happens at the IPG, after the
// customer identifies themselves by phone + OTP and picks one of their own
// eligible wallets. The merchant's own destination wallet is resolved
// server-side from currencyCode, same as any other purchase.
export class InitiateChargeDto {
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  currencyCode: string;

  // Which language the IPG pay page should render in for the customer
  // completing this specific charge — the merchant knows their customer,
  // the IPG itself has no session to guess from. Defaults to English.
  @IsOptional()
  @IsIn(['en', 'fa'])
  language?: 'en' | 'fa';

  // Overrides the merchant wallet's default settlement split (see
  // CreateWalletDto.settlementAccounts) for this one charge only — e.g. this
  // specific 1000 needs to be split 60/40 to two different IBANs instead of
  // the wallet's usual arrangement. Percentages must add up to exactly 100,
  // or fixed amounts (minor units) must add up to exactly `amount`.
  @IsOptional()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SettlementSplitDto)
  settlementSplits?: SettlementSplitDto[];
}
