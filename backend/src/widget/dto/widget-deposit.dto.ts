import { IsInt, IsOptional, IsUrl, IsUUID, Min } from 'class-validator';

// amount is expressed in minor units (e.g. cents) as a positive integer —
// mirrors transactions/dto/deposit.dto.ts.
export class WidgetDepositDto {
  @IsUUID()
  walletId: string;

  @IsInt()
  @Min(1)
  amount: number;

  // Where to send the browser after the ZarinPal leg completes — never
  // persisted, just round-tripped through the callback URL's query string
  // (see WidgetService.buildWidgetCallbackUrl). Optional: if omitted the
  // customer just sees a plain result page with nowhere to go back to.
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;
}
