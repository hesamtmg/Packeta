import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RequestPhoneOtpDto } from './dto/request-phone-otp.dto';
import { VerifyPhoneOtpDto } from './dto/verify-phone-otp.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // Same math captcha used by the IPG's own phone+OTP step — gates
  // request-otp against scripted phone-number enumeration.
  @Get('phone/captcha')
  requestPhoneCaptcha() {
    return this.authService.requestPhoneCaptcha();
  }

  @Post('phone/request-otp')
  @HttpCode(HttpStatus.OK)
  requestPhoneOtp(@Body() dto: RequestPhoneOtpDto) {
    return this.authService.requestPhoneOtp(
      dto.phoneNumber,
      dto.captchaId,
      dto.captchaAnswer,
    );
  }

  // Logs an existing phone in, or creates a fresh account if this is the
  // first time this number has verified — see AuthService.verifyPhoneOtp.
  @Post('phone/verify-otp')
  @HttpCode(HttpStatus.OK)
  verifyPhoneOtp(@Body() dto: VerifyPhoneOtpDto) {
    return this.authService.verifyPhoneOtp(dto.phoneNumber, dto.code);
  }
}
