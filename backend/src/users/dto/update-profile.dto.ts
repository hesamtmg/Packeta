import { IsOptional, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  // Same 10-digit convention as Wallet.nationalCode (create-wallet.dto.ts
  // etc.) — an empty string clears it, matching how the rest of this app's
  // optional-profile-field PATCH endpoints treat "" as "unset".
  @IsOptional()
  @Matches(/^(\d{10})?$/, { message: 'nationalCode must be 10 digits' })
  nationalCode?: string;
}
