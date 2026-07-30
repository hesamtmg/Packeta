import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { SettlementAccountDto } from '../../settlement/dto/settlement-account.dto';

export class CreateWalletDto {
  @IsUUID()
  walletTypeId: string;

  // Only meaningful when the wallet type's supportsAutoWithdraw is true:
  // exactly 3 "HH:MM" (24h, server-local) times the full balance sweeps out.
  @IsOptional()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true })
  autoWithdrawTimes?: string[];

  // Only meaningful when the wallet type's allowPurchaseIn is true: how long
  // (in seconds) a PURCHASE stays PENDING awaiting IPG verification before
  // the timeout sweep marks it REVERSED.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  purchaseTimeoutSeconds?: number;

  // Only meaningful when the wallet type's supportsAutoWithdraw is true:
  // the default IBAN split the auto-withdraw sweep pays this wallet's
  // purchases out to when a specific charge doesn't supply its own
  // override (see InitiateChargeDto.settlementSplits). Percentages across
  // the whole array must add up to exactly 100.
  @IsOptional()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SettlementAccountDto)
  settlementAccounts?: SettlementAccountDto[];
}
