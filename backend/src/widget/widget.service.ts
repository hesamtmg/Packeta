import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  WidgetSession,
  WidgetSessionStatus,
} from './entities/widget-session.entity';
import { WalletsService } from '../wallets/wallets.service';
import { UsersService } from '../users/users.service';
import { WalletTypeCode } from '../wallet-types/entities/wallet-type.entity';
import { serializeWallet } from '../wallets/wallet.serializer';
import { OtpService } from '../purchase-gateway/otp.service';
import { CaptchaService } from '../purchase-gateway/captcha.service';
import { displayIdentity } from '../common/synthetic-email';

const SESSION_TTL_MS = 10 * 60 * 1000;

export interface WidgetSessionResult {
  sessionToken: string;
  widgetUrl: string;
  expiresAt: Date;
}

export interface WidgetStatusResult {
  merchantName: string;
  requiresOtp: boolean;
  phoneNumber: string | null;
  status: WidgetSessionStatus;
  expiresAt: Date;
}

// Backs the wallet-viewing widget: a merchant's own backend mints a session
// here (server-to-server, real merchant JWT), then everything that resolves
// it to a real customer — OTP, or the non-OTP "trusted" path — runs through
// the public endpoints below, keyed by the session token alone. Same
// authority-scoped-token shape as PurchaseGatewayService, and reuses its
// OtpService/CaptchaService classes rather than inventing new auth (see
// WidgetModule) — just a different resource (a customer's own wallets)
// instead of a specific purchase.
@Injectable()
export class WidgetService {
  constructor(
    @InjectRepository(WidgetSession)
    private readonly widgetSessionsRepository: Repository<WidgetSession>,
    private readonly walletsService: WalletsService,
    private readonly usersService: UsersService,
    private readonly otpService: OtpService,
    private readonly captchaService: CaptchaService,
    private readonly configService: ConfigService,
  ) {}

  async createSession(
    merchantUserId: string,
    walletId: string,
    phoneNumber?: string,
    requestContext?: { ip?: string },
  ): Promise<WidgetSessionResult> {
    const wallet = await this.walletsService.getById(merchantUserId, walletId);
    if (
      wallet.walletType.code !== WalletTypeCode.MERCHANT ||
      !wallet.walletType.allowWidget
    ) {
      throw new BadRequestException(
        'This wallet is not enabled for the wallet-viewing widget',
      );
    }
    if (wallet.allowedIps?.length) {
      const ip = requestContext?.ip;
      if (!ip || !wallet.allowedIps.includes(ip)) {
        throw new ForbiddenException(
          'This request does not come from an allowed IP for this wallet',
        );
      }
    }
    if (!wallet.walletType.widgetRequiresOtp && !phoneNumber) {
      throw new BadRequestException(
        'phoneNumber is required to create a non-OTP widget session',
      );
    }

    const session = this.widgetSessionsRepository.create({
      walletId: wallet.id,
      token: randomUUID(),
      phoneNumber: phoneNumber ?? null,
      status: WidgetSessionStatus.PENDING,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    await this.widgetSessionsRepository.save(session);

    const ipgFrontendUrl = this.configService.get<string>('ipgFrontendUrl');
    return {
      sessionToken: session.token,
      widgetUrl: `${ipgFrontendUrl}/widget/${session.token}`,
      expiresAt: session.expiresAt,
    };
  }

  async getStatus(token: string): Promise<WidgetStatusResult> {
    const session = await this.getPendingOrAuthenticated(token);
    const wallet = await this.walletsService.getByIdUnscoped(session.walletId);
    const merchant = await this.usersService.findById(wallet.userId);
    return {
      merchantName:
        wallet.storeName || (merchant ? displayIdentity(merchant) : 'Merchant'),
      requiresOtp: wallet.walletType.widgetRequiresOtp,
      phoneNumber: session.phoneNumber
        ? maskPhoneNumber(session.phoneNumber)
        : null,
      status: session.status,
      expiresAt: session.expiresAt,
    };
  }

  async requestOtp(
    token: string,
    phoneNumber: string | undefined,
    captchaId: string,
    captchaAnswer: string,
  ): Promise<{ devCode: string }> {
    const session = await this.getPendingOrAuthenticated(token);
    const wallet = await this.walletsService.getByIdUnscoped(session.walletId);
    if (!wallet.walletType.widgetRequiresOtp) {
      throw new BadRequestException(
        'This wallet does not use OTP — call the authenticate endpoint instead',
      );
    }

    if (!this.captchaService.verify(captchaId, captchaAnswer)) {
      throw new ForbiddenException('Incorrect or expired captcha answer');
    }

    const targetPhone = session.phoneNumber ?? phoneNumber;
    if (!targetPhone) {
      throw new BadRequestException('phoneNumber is required');
    }
    const user = await this.usersService.findByPhoneNumber(targetPhone);
    if (!user) {
      throw new NotFoundException(
        'No account is registered with that phone number',
      );
    }

    const code = this.otpService.generateOtp(token, user.id);
    return { devCode: code };
  }

  async verifyOtp(
    token: string,
    code: string,
  ): Promise<{ authenticated: true }> {
    const session = await this.getPendingOrAuthenticated(token);
    const userId = this.otpService.verifyOtp(token, code);
    if (!userId) {
      throw new ForbiddenException('Invalid or expired code');
    }
    session.userId = userId;
    session.status = WidgetSessionStatus.AUTHENTICATED;
    await this.widgetSessionsRepository.save(session);
    return { authenticated: true };
  }

  // The non-OTP "trusted" path: the merchant already asserted this phone
  // number at session creation (see createSession), so this just resolves
  // it to an account — no code, no live challenge. Only reachable when the
  // wallet type opted into that weaker guarantee.
  async authenticate(token: string): Promise<{ authenticated: true }> {
    const session = await this.getPendingOrAuthenticated(token);
    const wallet = await this.walletsService.getByIdUnscoped(session.walletId);
    if (wallet.walletType.widgetRequiresOtp) {
      throw new BadRequestException('This wallet requires OTP verification');
    }
    if (!session.phoneNumber) {
      throw new BadRequestException(
        'This session was not created with a phone number to trust',
      );
    }
    const user = await this.usersService.findByPhoneNumber(session.phoneNumber);
    if (!user) {
      throw new NotFoundException(
        'No account is registered with that phone number',
      );
    }
    session.userId = user.id;
    session.status = WidgetSessionStatus.AUTHENTICATED;
    await this.widgetSessionsRepository.save(session);
    return { authenticated: true };
  }

  async getWallets(token: string) {
    const session = await this.getPendingOrAuthenticated(token);
    if (
      session.status !== WidgetSessionStatus.AUTHENTICATED ||
      !session.userId
    ) {
      throw new ForbiddenException('This session has not authenticated yet');
    }
    const wallets = (
      await this.walletsService.listForUser(session.userId)
    ).filter((wallet) => !wallet.walletType.hiddenFromCustomer);
    return wallets.map((wallet) => serializeWallet(wallet));
  }

  private async getPendingOrAuthenticated(
    token: string,
  ): Promise<WidgetSession> {
    const session = await this.widgetSessionsRepository.findOne({
      where: { token },
    });
    if (!session) {
      throw new NotFoundException('Widget session not found');
    }
    if (session.expiresAt < new Date()) {
      throw new ForbiddenException('This widget session has expired');
    }
    return session;
  }
}

// Keeps only the last 4 digits visible — enough for a customer to recognize
// their own number was pre-filled by the merchant, not enough to be useful
// to anyone else who might see the widget's status response.
function maskPhoneNumber(phoneNumber: string): string {
  return phoneNumber.slice(0, -4).replace(/./g, '•') + phoneNumber.slice(-4);
}
