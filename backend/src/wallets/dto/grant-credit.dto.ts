import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import {
  normalizePhoneNumber,
  PHONE_NUMBER_REGEX,
} from '../../common/phone-number';

// A repository owner grants a slice of their virtual pool to an existing
// user (looked up by phone — they must already have an account, same as
// every other wallet in the system) as a new credit wallet — see
// WalletsService.grantCredit.
export class GrantCreditDto {
  @IsUUID()
  repositoryWalletId: string;

  @Transform(({ value }) => normalizePhoneNumber(value))
  @Matches(PHONE_NUMBER_REGEX, {
    message: 'personnelPhoneNumber must be a valid phone number',
  })
  personnelPhoneNumber: string;

  @IsUUID()
  walletTypeId: string;

  @IsInt()
  @Min(1)
  virtualAmount: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'nationalCode must be 10 digits' })
  nationalCode?: string;
}
