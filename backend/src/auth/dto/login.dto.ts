import { IsString } from 'class-validator';

export class LoginDto {
  // Same identifier signup accepts — email or username, matched exactly
  // against the stored value.
  @IsString()
  email: string;

  @IsString()
  password: string;
}
