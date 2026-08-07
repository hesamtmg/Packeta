import { IsString, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  // Doubles as a username — a real email address isn't required, phone+OTP
  // is the primary way in. Still stored in the `email` column since so much
  // of the app resolves counterparties by it (see synthetic-email.ts).
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  email: string;

  @MinLength(8)
  password: string;
}
