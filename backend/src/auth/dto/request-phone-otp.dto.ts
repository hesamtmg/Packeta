import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';
import {
  normalizePhoneNumber,
  PHONE_NUMBER_REGEX,
} from '../../common/phone-number';

export class RequestPhoneOtpDto {
  @Transform(({ value }) => normalizePhoneNumber(value))
  @Matches(PHONE_NUMBER_REGEX, {
    message: 'phoneNumber must be a valid phone number (e.g. +15551234567)',
  })
  phoneNumber: string;

  @IsString()
  captchaId: string;

  @IsString()
  captchaAnswer: string;
}
