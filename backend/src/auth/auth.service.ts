import { randomUUID } from 'crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { LoggingService } from '../logging/logging.service';
import { AuthOtpService } from './auth-otp.service';
import { CaptchaService } from '../purchase-gateway/captcha.service';
import { syntheticEmailForPhone } from '../common/synthetic-email';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly jwtService: JwtService,
    private readonly loggingService: LoggingService,
    private readonly authOtpService: AuthOtpService,
    private readonly captchaService: CaptchaService,
  ) {}

  async signup(dto: SignupDto): Promise<{ accessToken: string }> {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      await this.loggingService.log({
        category: 'AUTH',
        action: 'SIGNUP',
        success: false,
        metadata: { email: dto.email, reason: 'email already registered' },
      });
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.dataSource.transaction(async (manager) => {
      const created = manager.create(User, {
        email: dto.email,
        passwordHash,
      });
      const savedUser = await manager.save(created);
      await this.walletsService.createDefaultWalletsForUser(
        manager,
        savedUser.id,
      );
      return savedUser;
    });

    await this.loggingService.log({
      category: 'AUTH',
      action: 'SIGNUP',
      success: true,
      userId: user.id,
      metadata: { email: user.email },
    });

    return this.issueToken(user);
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    const passwordMatches = user
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      await this.loggingService.log({
        category: 'AUTH',
        action: 'LOGIN',
        success: false,
        userId: user?.id,
        metadata: { email: dto.email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.loggingService.log({
      category: 'AUTH',
      action: 'LOGIN',
      success: true,
      userId: user.id,
      metadata: { email: user.email },
    });

    return this.issueToken(user);
  }

  requestPhoneCaptcha(): { captchaId: string; image: string } {
    return this.captchaService.generate();
  }

  async requestPhoneOtp(
    phoneNumber: string,
    captchaId: string,
    captchaAnswer: string,
  ): Promise<{ devCode: string }> {
    if (!this.captchaService.verify(captchaId, captchaAnswer)) {
      throw new UnauthorizedException('Incorrect or expired captcha answer');
    }

    const code = this.authOtpService.generateOtp(phoneNumber);
    // Sandbox: there's no real SMS provider wired up, so the "sent" code is
    // just handed straight back instead of actually texting it.
    return { devCode: code };
  }

  // Doubles as both login and signup: a phone number that already belongs
  // to an account logs it in, an unrecognized one creates a fresh account
  // (with its own default wallet set) on the spot — matching how phone+OTP
  // auth reads to a user, whether they're new or returning.
  async verifyPhoneOtp(
    phoneNumber: string,
    code: string,
  ): Promise<{ accessToken: string }> {
    if (!this.authOtpService.verifyOtp(phoneNumber, code)) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    let user = await this.usersService.findByPhoneNumber(phoneNumber);
    const isNewUser = !user;

    if (!user) {
      const passwordHash = await bcrypt.hash(randomUUID(), SALT_ROUNDS);
      user = await this.dataSource.transaction(async (manager) => {
        const created = manager.create(User, {
          email: syntheticEmailForPhone(phoneNumber),
          passwordHash,
          phoneNumber,
        });
        const savedUser = await manager.save(created);
        await this.walletsService.createDefaultWalletsForUser(
          manager,
          savedUser.id,
        );
        return savedUser;
      });
    }

    await this.loggingService.log({
      category: 'AUTH',
      action: isNewUser ? 'PHONE_SIGNUP' : 'PHONE_LOGIN',
      success: true,
      userId: user.id,
      metadata: { phoneNumber },
    });

    return this.issueToken(user);
  }

  private issueToken(user: User): { accessToken: string } {
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });
    return { accessToken };
  }
}
