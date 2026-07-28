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

  private issueToken(user: User): { accessToken: string } {
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });
    return { accessToken };
  }
}
