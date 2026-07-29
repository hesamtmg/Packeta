import { Matches } from 'class-validator';
import { PHONE_NUMBER_REGEX } from '../../common/phone-number';

export class SetPhoneNumberDto {
  @Matches(PHONE_NUMBER_REGEX, {
    message: 'phoneNumber must be a valid phone number (e.g. +15551234567)',
  })
  phoneNumber: string;
}
