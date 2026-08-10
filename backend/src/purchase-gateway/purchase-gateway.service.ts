import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { TransactionsService } from '../transactions/transactions.service';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { WalletTypeCode } from '../wallet-types/entities/wallet-type.entity';
import { OtpService } from './otp.service';
import { CaptchaService } from './captcha.service';
import { serializeWallet } from '../wallets/wallet.serializer';
import {
  formatAmount,
  formatAmountFarsi,
  formatAmountWords,
} from '../common/format-amount';
import { displayIdentity } from '../common/synthetic-email';

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
    private readonly i18n: I18nService,
  ) {}

  // Also backs the persistent merchant-info + countdown header the pay page
  // shows across every step (phone/OTP/wallet-select), not just the final
  // confirm screen — the timeout is the same one configured on the
  // merchant's wallet at creation (purchaseTimeoutSeconds).
  async getStatus(authority: string): Promise<{
    needsWalletSelection: boolean;
    merchantName: string;
    storeSite: string | null;
    terminalId: string | null;
    acceptorCode: string | null;
    category: string | null;
    subCategory: string | null;
    displayAmount: string;
    displayAmountFa: string;
    displayAmountWordsEn: string;
    displayAmountWordsFa: string;
    expiresAt: Date | null;
    language: string;
  }> {
    const transaction =
      await this.transactionsService.findByIpgAuthority(authority);
    if (!transaction) {
      throw new NotFoundException(
        this.i18n.t('purchaseGateway.PAYMENT_NOT_FOUND'),
      );
    }

    const toWallet = await this.walletsService.getByIdUnscoped(
      transaction.toWalletId!,
    );
    const merchant = await this.usersService.findById(toWallet.userId);

    return {
      needsWalletSelection: !transaction.fromWalletId,
      // Prefer the merchant's own configured storefront name over their raw
      // account identity, when they've set one.
      merchantName:
        toWallet.storeName ||
        (merchant ? displayIdentity(merchant) : 'Merchant'),
      storeSite: toWallet.storeSite,
      terminalId: toWallet.terminalId,
      acceptorCode: toWallet.acceptorCode,
      category: toWallet.category,
      subCategory: toWallet.subCategory,
      displayAmount: formatAmount(
        transaction.amount,
        toWallet.walletType.currency,
      ),
      displayAmountFa: formatAmountFarsi(
        transaction.amount,
        toWallet.walletType.currency,
      ),
      displayAmountWordsEn: formatAmountWords(
        transaction.amount,
        toWallet.walletType.currency,
        'en',
      ),
      displayAmountWordsFa: formatAmountWords(
        transaction.amount,
        toWallet.walletType.currency,
        'fa',
      ),
      expiresAt: transaction.expiresAt,
      language: transaction.language ?? 'en',
    };
  }

  async requestCaptcha(): Promise<{ captchaId: string; image: string }> {
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
      throw new UnauthorizedException(this.i18n.t('common.INVALID_CAPTCHA'));
    }

    const user = await this.usersService.findByPhoneNumber(phoneNumber);
    if (!user) {
      throw new NotFoundException(this.i18n.t('common.NO_ACCOUNT_FOR_PHONE'));
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
      throw new UnauthorizedException(this.i18n.t('common.INVALID_OTP'));
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
  ): Promise<{
    transactionId: string;
    insufficientCredit?: { shortfall: string; availableCredit: string };
  }> {
    const { charge, wallet } = await this.validateWalletChoice(
      authority,
      sessionToken,
      walletId,
    );

    // A CREDIT wallet that can't cover this charge on its own isn't
    // attached yet — the customer needs to see the shortfall and explicitly
    // agree to pay it (see confirmSupportTopUp) before anything's
    // committed. Every other case attaches immediately, unchanged.
    if (
      wallet.walletType.code === WalletTypeCode.CREDIT &&
      wallet.repositoryWalletId
    ) {
      const availableCredit =
        await this.walletsService.getAvailableCredit(wallet);
      const chargeAmount = BigInt(charge.amount);
      if (chargeAmount > availableCredit) {
        return {
          transactionId: charge.id,
          insufficientCredit: {
            shortfall: (chargeAmount - availableCredit).toString(),
            availableCredit: availableCredit.toString(),
          },
        };
      }
    }

    await this.transactionsService.attachPurchaseWallet(authority, wallet.id);
    return { transactionId: charge.id };
  }

  // Called once the customer has seen the shortfall attachWallet reported
  // and clicked through to pay it — re-derives the shortfall server-side
  // (never trusts the client's own number), attaches the credit wallet to
  // the charge, and kicks off a real ZarinPal payment for the difference.
  async confirmSupportTopUp(
    authority: string,
    sessionToken: string,
    walletId: string,
  ): Promise<{ redirectUrl: string }> {
    const { charge, wallet } = await this.validateWalletChoice(
      authority,
      sessionToken,
      walletId,
    );
    if (
      wallet.walletType.code !== WalletTypeCode.CREDIT ||
      !wallet.repositoryWalletId
    ) {
      throw new BadRequestException(
        this.i18n.t('purchaseGateway.TOPUP_NOT_SUPPORTED'),
      );
    }

    const availableCredit =
      await this.walletsService.getAvailableCredit(wallet);
    const chargeAmount = BigInt(charge.amount);
    if (chargeAmount <= availableCredit) {
      throw new BadRequestException(
        this.i18n.t('purchaseGateway.TOPUP_NOT_NEEDED'),
      );
    }

    await this.transactionsService.attachPurchaseWallet(authority, wallet.id);
    const { redirectUrl } = await this.transactionsService.initiateSupportTopUp(
      charge.id,
      chargeAmount - availableCredit,
    );
    return { redirectUrl };
  }

  // Shared by attachWallet and confirmSupportTopUp: resolves the session,
  // loads the customer's chosen wallet, and runs every eligibility check
  // that doesn't depend on whether a top-up is involved.
  private async validateWalletChoice(
    authority: string,
    sessionToken: string,
    walletId: string,
  ) {
    const charge = await this.getPendingCharge(authority);

    const userId = this.otpService.resolveSession(authority, sessionToken);
    if (!userId) {
      throw new UnauthorizedException(
        this.i18n.t('purchaseGateway.SESSION_EXPIRED'),
      );
    }

    // getById throws NotFound/Forbidden if the wallet isn't this user's own.
    const wallet = await this.walletsService.getById(userId, walletId);
    const toWallet = await this.walletsService.getByIdUnscoped(
      charge.toWalletId!,
    );
    if (
      wallet.closedAt ||
      toWallet.closedAt ||
      !wallet.walletType.allowPurchaseOut ||
      wallet.walletType.currencyId !== toWallet.walletType.currencyId
    ) {
      throw new BadRequestException(
        this.i18n.t('purchaseGateway.WALLET_NOT_USABLE'),
      );
    }
    // A wallet frozen by InstallmentsService's overdue sweep can't fund a
    // new purchase this way either — the same rule TransactionsService
    // .assertNotBlocked enforces on the self-service initiatePurchase path,
    // just checked here since a merchant-initiated charge never goes
    // through that method.
    if (wallet.blockedAt) {
      throw new ForbiddenException(
        this.i18n.t('purchaseGateway.WALLET_BLOCKED'),
      );
    }

    const [customer, merchant] = await Promise.all([
      this.usersService.findById(userId),
      this.usersService.findById(toWallet.userId),
    ]);
    if (
      !this.walletsService.isCounterpartyAllowed(
        wallet.restrictedCounterparties,
        merchant!.email,
        toWallet.restrictedCounterparties,
        customer!.email,
      )
    ) {
      throw new BadRequestException(
        this.i18n.t('purchaseGateway.COUNTERPARTY_NOT_ALLOWED'),
      );
    }
    this.walletsService.assertWithinTransactionLimits(
      wallet,
      BigInt(charge.amount),
    );

    return { charge, wallet };
  }

  private async getPendingCharge(authority: string) {
    const charge =
      await this.transactionsService.findPendingChargeByAuthority(authority);
    if (!charge) {
      throw new NotFoundException(
        this.i18n.t('purchaseGateway.PAYMENT_NOT_FOUND_OR_RESOLVED'),
      );
    }
    return charge;
  }
}
