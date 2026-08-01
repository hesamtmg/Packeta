import { Transform } from 'class-transformer';
import { Length, Matches } from 'class-validator';
import {
  normalizePhoneNumber,
  PHONE_NUMBER_REGEX,
} from '../../common/phone-number';

export class VerifyPhoneOtpDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @Matches(PHONE_NUMBER_REGEX, {
    message: 'phoneNumber must be a valid phone number (e.g. +15551234567)',
  })
  phoneNumber: string;

  @Length(6, 6)
  code: string;
}
