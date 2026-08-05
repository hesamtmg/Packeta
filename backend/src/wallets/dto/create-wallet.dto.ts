import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsEmail,
  IsEnum,
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
import { SettlementRailType } from '../../rail-settlements/entities/rail-settlement.entity';

export class CreateWalletDto {
  @IsUUID()
  walletTypeId: string;

  // A customer-chosen display name for this specific wallet — purely
  // cosmetic, shown in place of the wallet type's name wherever this wallet
  // appears (cards, transaction from/to, transaction detail).
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

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

  // Credit-line fields (repository/credit wallet feature). Only meaningful
  // on wallets of a credit-style type — per-person, unlike the shared
  // billing rules on WalletType (fee, penalty, installment schedule, etc.).
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  virtualAmount?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'nationalCode must be 10 digits' })
  nationalCode?: string;

  // Withdrawal-schedule rail (only meaningful when the wallet type's
  // supportsAutoWithdraw is true) — which of Iran's interbank rails the
  // auto-withdraw sweep pays this wallet out over. See the Wallet entity.
  @IsOptional()
  @IsEnum(SettlementRailType)
  railType?: SettlementRailType;

  // Optional "HH:MM" schedule override for the chosen rail — required when
  // railType is BANK_TRANSFER (no sensible built-in default exists), falls
  // back to the rail's built-in default for every other rail when omitted.
  @IsOptional()
  @ArrayMinSize(1)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { each: true })
  railScheduleTimes?: string[];
}
