import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import {
  CreateIpgPaymentInput,
  IpgVerifyResult,
} from '../ipg/ipg-client.service';
import { ZarinpalClientService } from '../ipg/zarinpal-client.service';
import { SadadClientService } from '../ipg/sadad-client.service';
import { PlatformSetting } from './entities/platform-setting.entity';
import { PaymentGatewayProvider } from './payment-gateway-provider';

export const ACTIVE_GATEWAY_SETTING_KEY = 'payment_gateway.active_provider';

export interface GatewayPaymentResult {
  authority: string;
  paymentUrl: string;
  provider: PaymentGatewayProvider;
}

export interface GatewayProviderStatus {
  provider: PaymentGatewayProvider;
  configured: boolean;
  configurationError: string | null;
  sandbox: boolean;
}

// Single entry point for every real-money payment (deposits, installment
// repayments, overdue/quit collections, support top-ups). Routes to whichever
// PSP a super-admin picked in the admin panel — ZarinPal or Sadad — and
// verifies each payment with the provider recorded on its transaction.
//
// The two gateways return the customer differently: ZarinPal redirects with
// a GET carrying ?Authority=&Status=OK|NOK, Sadad POSTs a form (token,
// ResCode, OrderId) to its ReturnUrl. Sadad's ReturnUrl therefore points at
// SadadReturnController on this backend, carrying the real (frontend)
// callback URL HMAC-signed in the query string; that controller converts
// the POST into the same ZarinPal-style GET redirect, so every callback page
// in the frontends works unchanged for both providers.
@Injectable()
export class PaymentGatewayService {
  constructor(
    @InjectRepository(PlatformSetting)
    private readonly settingsRepository: Repository<PlatformSetting>,
    private readonly configService: ConfigService,
    private readonly zarinpalClientService: ZarinpalClientService,
    private readonly sadadClientService: SadadClientService,
  ) {}

  async getActiveProvider(): Promise<PaymentGatewayProvider> {
    const row = await this.settingsRepository.findOne({
      where: { key: ACTIVE_GATEWAY_SETTING_KEY },
    });
    const value = row?.value as PaymentGatewayProvider | undefined;
    return value && Object.values(PaymentGatewayProvider).includes(value)
      ? value
      : PaymentGatewayProvider.ZARINPAL;
  }

  async getSetting(): Promise<{
    activeProvider: PaymentGatewayProvider;
    updatedAt: Date | null;
    updatedByUserId: string | null;
    providers: GatewayProviderStatus[];
  }> {
    const row = await this.settingsRepository.findOne({
      where: { key: ACTIVE_GATEWAY_SETTING_KEY },
    });
    return {
      activeProvider: await this.getActiveProvider(),
      updatedAt: row?.updatedAt ?? null,
      updatedByUserId: row?.updatedByUserId ?? null,
      providers: this.providerStatuses(),
    };
  }

  async setActiveProvider(
    provider: PaymentGatewayProvider,
    userId: string,
  ): Promise<void> {
    const status = this.providerStatuses().find((p) => p.provider === provider);
    if (!status?.configured) {
      throw new BadRequestException(
        `${provider} can't be activated: ${status?.configurationError ?? 'not configured'}`,
      );
    }
    await this.settingsRepository.save({
      key: ACTIVE_GATEWAY_SETTING_KEY,
      value: provider,
      updatedByUserId: userId,
    });
  }

  providerStatuses(): GatewayProviderStatus[] {
    const zarinpalBase =
      this.configService.get<string>('zarinpal.baseUrl') ?? '';
    const zarinpalMerchant =
      this.configService.get<string>('zarinpal.merchantId') ?? '';
    const sadadError = this.sadadClientService.configurationError();
    return [
      {
        provider: PaymentGatewayProvider.ZARINPAL,
        configured: Boolean(zarinpalBase && zarinpalMerchant),
        configurationError:
          zarinpalBase && zarinpalMerchant
            ? null
            : 'ZARINPAL_BASE_URL and ZARINPAL_MERCHANT_ID must be set',
        sandbox: zarinpalBase.includes('sandbox'),
      },
      {
        provider: PaymentGatewayProvider.SADAD,
        configured: sadadError === null,
        configurationError: sadadError,
        sandbox: false,
      },
    ];
  }

  async createPayment(
    input: CreateIpgPaymentInput,
  ): Promise<GatewayPaymentResult> {
    const provider = await this.getActiveProvider();
    if (provider === PaymentGatewayProvider.SADAD) {
      const { authority, paymentUrl } =
        await this.sadadClientService.createPayment({
          ...input,
          callbackUrl: this.buildSadadReturnUrl(input.callbackUrl),
        });
      return { authority, paymentUrl, provider };
    }
    const { authority, paymentUrl } =
      await this.zarinpalClientService.createPayment(input);
    return { authority, paymentUrl, provider };
  }

  // provider is the transaction's ipgProvider — null for rows created before
  // Sadad existed, which were all ZarinPal.
  async verifyPayment(
    provider: PaymentGatewayProvider | string | null | undefined,
    authority: string,
    expectedAmount: string,
  ): Promise<IpgVerifyResult> {
    if (provider === PaymentGatewayProvider.SADAD) {
      return this.sadadClientService.verifyPayment(authority, expectedAmount);
    }
    return this.zarinpalClientService.verifyPayment(authority, expectedAmount);
  }

  buildSadadReturnUrl(callbackUrl: string): string {
    const base = (
      this.configService.get<string>('backendPublicUrl') ?? ''
    ).replace(/\/+$/, '');
    if (!base) {
      throw new ServiceUnavailableException(
        'BACKEND_PUBLIC_URL must be set to use Sadad',
      );
    }
    const params = new URLSearchParams({
      next: callbackUrl,
      sig: this.sign(callbackUrl),
    });
    return `${base}/payment-gateway/sadad/return?${params.toString()}`;
  }

  // Validates a return URL's signature and builds the browser redirect,
  // ZarinPal-style (?Authority=…&Status=OK|NOK) so the callback pages need
  // no Sadad-specific handling. Status=OK only means "the customer says it
  // went through" — nothing is credited until /verify asks Sadad itself.
  resolveSadadReturn(
    next: string | undefined,
    sig: string | undefined,
    token: string,
    resCode: string,
  ): string {
    if (!next || !sig || !this.isValidSignature(next, sig)) {
      throw new BadRequestException('Invalid Sadad return link');
    }
    const url = new URL(next);
    url.searchParams.set('Authority', token);
    url.searchParams.set('Status', resCode === '0' && token ? 'OK' : 'NOK');
    return url.toString();
  }

  private sign(value: string): string {
    const secret = this.configService.get<string>('jwt.secret') ?? '';
    return createHmac('sha256', `sadad-return:${secret}`)
      .update(value)
      .digest('base64url');
  }

  private isValidSignature(value: string, sig: string): boolean {
    const expected = Buffer.from(this.sign(value));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
