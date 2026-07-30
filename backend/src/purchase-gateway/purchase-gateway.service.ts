import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TransactionsService } from '../transactions/transactions.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { OtpService } from './otp.service';
import { CaptchaService } from './captcha.service';
import { serializeWallet } from '../wallets/wallet.serializer';
import { formatAmount } from '../common/format-amount';

// Backs the IPG's "identify yourself" step for merchant-initiated charges:
// the customer proves who they are with phone + OTP (no Packeta session
// required) and is then shown their own wallets eligible to pay this
// specific merchant, rather than Packeta resolving one automatically.
@Injectable()
export class PurchaseGatewayService {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly usersService: UsersService,
    private readonly walletsService: WalletsService,
    private readonly otpService: OtpService,
    private readonly captchaService: CaptchaService,
  ) {}

  // Also backs the persistent merchant-info + countdown header the pay page
  // shows across every step (phone/OTP/wallet-select), not just the final
  // confirm screen — the timeout is the same one configured on the
  // merchant's wallet at creation (purchaseTimeoutSeconds).
  async getStatus(authority: string): Promise<{
    needsWalletSelection: boolean;
    merchantName: string;
    displayAmount: string;
    expiresAt: Date | null;
    language: string;
  }> {
    const transaction =
      await this.transactionsService.findByIpgAuthority(authority);
    if (!transaction) {
      throw new NotFoundException('Payment not found');
    }

    const toWallet = await this.walletsService.getByIdUnscoped(
      transaction.toWalletId!,
    );
    const merchant = await this.usersService.findById(toWallet.userId);

    return {
      needsWalletSelection: !transaction.fromWalletId,
      merchantName: merchant?.email ?? 'Merchant',
      displayAmount: formatAmount(
        transaction.amount,
        toWallet.walletType.currency,
      ),
      expiresAt: transaction.expiresAt,
      language: transaction.language ?? 'en',
    };
  }

  async requestCaptcha(): Promise<{ captchaId: string; question: string }> {
    return this.captchaService.generate();
  }

  async requestOtp(
    authority: string,
    phoneNumber: string,
    captchaId: string,
    captchaAnswer: string,
  ): Promise<{ devCode: string }> {
    await this.getPendingCharge(authority);

    if (!this.captchaService.verify(captchaId, captchaAnswer)) {
      throw new UnauthorizedException('Incorrect or expired captcha answer');
    }

    const user = await this.usersService.findByPhoneNumber(phoneNumber);
    if (!user) {
      throw new NotFoundException(
        'No account is registered with that phone number',
      );
    }

    const code = this.otpService.generateOtp(authority, user.id);
    // Sandbox: there's no real SMS provider wired up, so the "sent" code is
    // just handed straight back instead of actually texting it.
    return { devCode: code };
  }

  async verifyOtp(
    authority: string,
    code: string,
  ): Promise<{ sessionToken: string; wallets: unknown[] }> {
    const charge = await this.getPendingCharge(authority);

    const userId = this.otpService.verifyOtp(authority, code);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const toWallet = await this.walletsService.getByIdUnscoped(
      charge.toWalletId!,
    );
    const wallets = await this.walletsService.listPurchaseEligibleWallets(
      userId,
      toWallet.walletType.currencyId,
    );

    const sessionToken = this.otpService.createSession(authority, userId);
    return {
      sessionToken,
      wallets: wallets.map((wallet) => serializeWallet(wallet)),
    };
  }

  async attachWallet(
    authority: string,
    sessionToken: string,
    walletId: string,
  ): Promise<{ transactionId: string }> {
    const charge = await this.getPendingCharge(authority);

    const userId = this.otpService.resolveSession(authority, sessionToken);
    if (!userId) {
      throw new UnauthorizedException(
        'Your session has expired — request a new code',
      );
    }

    // getById throws NotFound/Forbidden if the wallet isn't this user's own.
    const wallet = await this.walletsService.getById(userId, walletId);
    const toWallet = await this.walletsService.getByIdUnscoped(
      charge.toWalletId!,
    );
    if (
      !wallet.walletType.allowPurchaseOut ||
      wallet.walletType.currencyId !== toWallet.walletType.currencyId
    ) {
      throw new BadRequestException(
        'That wallet cannot be used for this purchase',
      );
    }

    await this.transactionsService.attachPurchaseWallet(authority, wallet.id);
    return { transactionId: charge.id };
  }

  private async getPendingCharge(authority: string) {
    const charge =
      await this.transactionsService.findPendingChargeByAuthority(authority);
    if (!charge) {
      throw new NotFoundException(
        'Payment not found, expired, or already resolved',
      );
    }
    return charge;
  }
}
