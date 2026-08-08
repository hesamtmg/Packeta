import { IsString, Length } from 'class-validator';

export class WidgetOtpVerifyDto {
  @IsString()
  @Length(6, 6)
  code: string;
}
