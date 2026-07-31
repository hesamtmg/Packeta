import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsEmail,
  IsIP,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
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

  // A closed marketplace: if set, this wallet may only transfer to, or
  // purchase from/be purchased from, a counterparty whose email is in this
  // list (see WalletsService.isCounterpartyAllowed). Omit or leave empty for
  // the default, unrestricted behavior.
  @IsOptional()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  restrictedCounterparties?: string[];

  // Merchant wallets only: the PSP terminal/acceptor identifiers this
  // wallet settles under. Purely descriptive — see the Wallet entity.
  @IsOptional()
  @IsString()
  terminalId?: string;

  @IsOptional()
  @IsString()
  acceptorCode?: string;

  // All wallets: an optional per-transaction amount band (minor units).
  // Both are independently optional; a transaction whose amount falls
  // outside whichever bound(s) are set is rejected.
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

  // All wallets: whether the self-service Deposit action is allowed here.
  // Defaults to true (matches the DB column default) when omitted.
  @IsOptional()
  @IsBoolean()
  depositable?: boolean;

  // Merchant wallets only: storefront identity + access controls — see the
  // Wallet entity for how each is used.
  @IsOptional()
  @IsString()
  @MaxLength(150)
  storeName?: string;

  @IsOptional()
  @ValidateIf((o) => o.storeSite !== '')
  @IsUrl({ require_tld: false })
  storeSite?: string;

  @IsOptional()
  @ArrayMinSize(1)
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
}
