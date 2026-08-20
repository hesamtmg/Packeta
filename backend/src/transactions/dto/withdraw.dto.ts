import { IsEnum, IsInt, IsString, IsUUID, Matches, Min } from 'class-validator';
import { SettlementRailType } from '../../rail-settlements/entities/rail-settlement.entity';
import { IBAN_REGEX } from '../../common/iban';

// amount is expressed in minor units (e.g. cents) as a positive integer.
// railType is which interbank rail (Pol Pay / Paya / Satna / bank transfer)
// the withdrawal goes out over — every manual withdrawal is rail-settled the
// same way an auto-withdraw sweep's payout is (see
// TransactionsService.withdraw and RailSettlementsService.createForSweep).
// destinationIban is the single account the money goes to — a customer's
// manual withdrawal, unlike a merchant's settlement-split payout, always has
// exactly one destination.
export class WithdrawDto {
  @IsUUID()
  walletId: string;

  @IsInt()
  @Min(1)
  amount: number;

  @IsEnum(SettlementRailType)
  railType: SettlementRailType;

  @IsString()
  @Matches(IBAN_REGEX, {
    message: 'destinationIban must look like a valid IBAN',
  })
  destinationIban: string;
}
