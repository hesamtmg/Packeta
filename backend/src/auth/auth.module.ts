import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthOtpService } from './auth-otp.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { WalletsModule } from '../wallets/wallets.module';
import { LoggingModule } from '../logging/logging.module';
import { CaptchaService } from '../purchase-gateway/captcha.service';
import { PanelRolesModule } from '../panel-roles/panel-roles.module';

@Module({
  imports: [
    UsersModule,
    WalletsModule,
    LoggingModule,
    PanelRolesModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiresIn') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AuthOtpService, CaptchaService],
})
export class AuthModule {}
