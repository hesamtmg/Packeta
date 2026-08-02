import { IsEnum, IsInt, IsUUID, Min } from 'class-validator';
import { SettlementRailType } from '../../rail-settlements/entities/rail-settlement.entity';

// amount is expressed in minor units (e.g. cents) as a positive integer.
// railType is which interbank rail (Pol Pay / Paya / Satna / bank transfer)
// the withdrawal goes out over — every manual withdrawal is rail-settled the
// same way an auto-withdraw sweep's payout is (see
// TransactionsService.withdraw and RailSettlementsService.createForSweep).
export class WithdrawDto {
  @IsUUID()
  walletId: string;

  @IsInt()
  @Min(1)
  amount: number;

  @IsEnum(SettlementRailType)
  railType: SettlementRailType;
}
