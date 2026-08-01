import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreateIpgPaymentInput, IpgVerifyResult } from './ipg-client.service';

interface ZarinpalRequestResponse {
  data: { code: number; message: string; authority: string } | [];
  errors: { code?: number; message?: string } | [];
}

interface ZarinpalVerifyResponse {
  data: { code: number; message: string; ref_id?: number } | [];
  errors: { code?: number; message?: string } | [];
}

// Real-money client for ZarinPal (https://www.zarinpal.com), used only for
// deposits — see TransactionsService.deposit/verifyPurchase. Unlike the
// in-house sandbox IPG (ipg-client.service.ts), a deposit only completes once
// an actual outside payment gateway confirms it. Defaults to ZarinPal's
// public sandbox (sandbox.zarinpal.com), which accepts any well-formed
// merchant id and settles no real money — point ZARINPAL_BASE_URL /
// ZARINPAL_MERCHANT_ID at production values to go live.
//
// ZarinPal's REST API only speaks Iranian Toman; wallet amounts are passed
// through as-is (same convention the sandbox IPG's `amount` already used),
// so this integration is currency-accurate for IRR/Toman wallets only.
@Injectable()
export class ZarinpalClientService {
  constructor(private readonly configService: ConfigService) {}

  async createPayment(
    input: CreateIpgPaymentInput,
  ): Promise<{ authority: string; paymentUrl: string }> {
    const merchantId = this.merchantId();
    const response = await this.request<ZarinpalRequestResponse>(
      '/pg/v4/payment/request.json',
      {
        merchant_id: merchantId,
        amount: Math.round(Number(input.amount)),
        callback_url: input.callbackUrl,
        description: input.merchantName,
      },
    );

    const data = Array.isArray(response.data) ? null : response.data;
    if (!data || data.code !== 100) {
      const errors = Array.isArray(response.errors) ? null : response.errors;
      throw new ServiceUnavailableException(
        errors?.message ?? 'ZarinPal rejected the payment request',
      );
    }

    return {
      authority: data.authority,
      paymentUrl: `${this.baseUrl()}/pg/StartPay/${data.authority}`,
    };
  }

  async verifyPayment(
    authority: string,
    expectedAmount: string,
  ): Promise<IpgVerifyResult> {
    const merchantId = this.merchantId();
    const response = await this.request<ZarinpalVerifyResponse>(
      '/pg/v4/payment/verify.json',
      {
        merchant_id: merchantId,
        amount: Math.round(Number(expectedAmount)),
        authority,
      },
    );

    const data = Array.isArray(response.data) ? null : response.data;
    // 100 = freshly verified, 101 = already verified earlier (still a
    // success — verify() may be called more than once for the same payment).
    if (data && (data.code === 100 || data.code === 101)) {
      return { success: true, refId: data.ref_id?.toString() };
    }

    const errors = Array.isArray(response.errors) ? null : response.errors;
    return {
      success: false,
      reason:
        errors?.message ?? data?.message ?? 'ZarinPal declined the payment',
    };
  }

  private baseUrl(): string {
    return this.configService.get<string>('zarinpal.baseUrl')!;
  }

  private merchantId(): string {
    return this.configService.get<string>('zarinpal.merchantId')!;
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl()}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ServiceUnavailableException('ZarinPal is unreachable');
    }

    const data = await response.json().catch(() => null);
    if (!data) {
      throw new ServiceUnavailableException(
        'ZarinPal returned an unreadable response',
      );
    }
    return data as T;
  }
}
