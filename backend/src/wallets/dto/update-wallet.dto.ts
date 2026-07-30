import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsEmail,
  IsInt,
  IsOptional,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { SettlementAccountDto } from '../../settlement/dto/settlement-account.dto';

// Same fields as CreateWalletDto minus walletTypeId (fixed for the life of
// the wallet) — every field here fully replaces its current value when
// provided; omitting a field leaves it untouched. To clear a field back to
// "unset", send an explicit empty array (autoWithdrawTimes/
// restrictedCounterparties) — settlementAccounts still requires at least
// one entry if provided at all, same as at creation, since an empty split
// set can't fund a purchase's settlement. autoWithdrawTimes must still be
// exactly 3 entries if non-empty — checked in the controller alongside the
// wallet-type capability checks, not here, since "empty is fine, non-empty
// must be exactly 3" isn't expressible with a single array-size decorator.
export class UpdateWalletDto {
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true })
  autoWithdrawTimes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  purchaseTimeoutSeconds?: number;

  @IsOptional()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SettlementAccountDto)
  settlementAccounts?: SettlementAccountDto[];

  @IsOptional()
  @IsEmail({}, { each: true })
  restrictedCounterparties?: string[];
}
