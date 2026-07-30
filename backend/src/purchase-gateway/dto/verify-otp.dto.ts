import { IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  authority: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
