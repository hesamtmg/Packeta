import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';
import {
  normalizePhoneNumber,
  PHONE_NUMBER_REGEX,
} from '../../common/phone-number';

// phoneNumber is optional here: a session pre-bound with one at creation
// (see CreateWidgetSessionDto) already knows who's asking — see
// WidgetService.requestOtp.
export class WidgetOtpRequestDto {
  @IsOptional()
  @Transform(({ value }) => (value ? normalizePhoneNumber(value) : value))
  @Matches(PHONE_NUMBER_REGEX, {
    message: 'phoneNumber must be a valid phone number (e.g. +15551234567)',
  })
  phoneNumber?: string;

  @IsString()
  captchaId: string;

  @IsString()
  captchaAnswer: string;
}
