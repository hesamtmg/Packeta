import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

// Admin creates a basic wallet on a customer's behalf (e.g. an admin-panel
// "Add wallet" action) — a deliberately narrower surface than the
// self-service POST /wallets (no merchant-only fields like settlement
// accounts, terminal id, or an IP allowlist), since the admin panel is for
// quickly provisioning a wallet, not configuring a merchant integration.
export class AdminCreateWalletDto {
  @IsUUID()
  walletTypeId: string;

  // Only meaningful when the wallet type's hasVirtualBalance is true.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  virtualAmount?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'nationalCode must be 10 digits' })
  nationalCode?: string;
}
