import { Transform } from 'class-transformer';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import {
  normalizePhoneNumber,
  PHONE_NUMBER_REGEX,
} from '../../common/phone-number';

export class CreateWidgetSessionDto {
  @IsUUID()
  walletId: string;

  // Pre-binds the session to a customer the merchant already knows the
  // phone number of — required for the non-OTP ("trusted") path, and used
  // to skip the phone-entry step even when OTP is still required.
  @IsOptional()
  @Transform(({ value }) => (value ? normalizePhoneNumber(value) : value))
  @Matches(PHONE_NUMBER_REGEX, {
    message: 'phoneNumber must be a valid phone number (e.g. +15551234567)',
  })
  phoneNumber?: string;
}
