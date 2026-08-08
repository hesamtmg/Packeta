import { IsOptional, IsUrl } from 'class-validator';

export class WidgetPayInstallmentDto {
  // See WidgetDepositDto.returnUrl — same round-trip-only mechanism.
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;
}
