import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsEmail,
  IsEnum,
  IsIP,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SettlementAccountDto } from '../../settlement/dto/settlement-account.dto';
import { SettlementRailType } from '../../rail-settlements/entities/rail-settlement.entity';

// Same fields as CreateWalletDto minus walletTypeId (fixed for the life of
// the wallet) — every field here fully replaces its current value when
// provided; omitting a field leaves it untouched. To clear a field back to
// "unset", send an explicit empty array (restrictedCounterparties/
// allowedIps) — settlementAccounts still requires at least one entry if
// provided at all, same as at creation, since an empty split set can't fund
// a purchase's settlement.
export class UpdateWalletDto {
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

  @IsOptional()
  @IsString()
  terminalId?: string;

  @IsOptional()
  @IsString()
  acceptorCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minTransactionAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxTransactionAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  storeName?: string;

  @IsOptional()
  @ValidateIf((o) => o.storeSite !== '')
  @IsUrl({ require_tld: false })
  storeSite?: string;

  @IsOptional()
  @IsIP(undefined, { each: true })
  allowedIps?: string[];

  @IsOptional()
  @ValidateIf((o) => o.callbackUrl !== '')
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  callbackUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  subCategory?: string;

  // Credit-line fields (repository/credit wallet feature). Per-person,
  // unlike the shared billing rules on WalletType.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  virtualAmount?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'nationalCode must be 10 digits' })
  nationalCode?: string;

  // Withdrawal-schedule rail — see CreateWalletDto.
  @IsOptional()
  @IsEnum(SettlementRailType)
  railType?: SettlementRailType;

  @IsOptional()
  @ArrayMinSize(1)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true })
  railScheduleTimes?: string[];
}
