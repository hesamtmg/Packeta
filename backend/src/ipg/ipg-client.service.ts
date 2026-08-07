import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CreateIpgPaymentInput {
  merchantName: string;
  amount: string;
  displayAmount: string;
  displayAmountFa?: string;
  displayAmountWordsEn?: string;
  displayAmountWordsFa?: string;
  callbackUrl: string;
  timeoutSeconds: number;
  terminalId?: string | null;
  acceptorCode?: string | null;
  storeSite?: string | null;
  category?: string | null;
  subCategory?: string | null;
}

export interface IpgVerifyResult {
  success: boolean;
  reason?: string;
  refId?: string;
}

// Thin client for the sandbox IPG (ipg-backend/). It holds no balances of
// its own — it only tracks a payment page's INITIATED/AUTHORIZED/VERIFIED
// state — so Packeta's own ledger is still the source of truth for money.
@Injectable()
export class IpgClientService {
  constructor(private readonly configService: ConfigService) {}

  async createPayment(
    input: CreateIpgPaymentInput,
  ): Promise<{ authority: string; paymentUrl: string }> {
    return this.request('POST', '/payments', {
      merchantName: input.merchantName,
      amount: Number(input.amount),
      displayAmount: input.displayAmount,
      displayAmountFa: input.displayAmountFa ?? undefined,
      displayAmountWordsEn: input.displayAmountWordsEn ?? undefined,
      displayAmountWordsFa: input.displayAmountWordsFa ?? undefined,
      callbackUrl: input.callbackUrl,
      timeoutSeconds: input.timeoutSeconds,
      terminalId: input.terminalId ?? undefined,
      acceptorCode: input.acceptorCode ?? undefined,
      storeSite: input.storeSite ?? undefined,
      category: input.category ?? undefined,
      subCategory: input.subCategory ?? undefined,
    });
  }

  async verifyPayment(
    authority: string,
    expectedAmount: string,
  ): Promise<IpgVerifyResult> {
    return this.request('POST', `/payments/${authority}/verify`, {
      amount: Number(expectedAmount),
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const baseUrl = this.configService.get<string>('ipg.baseUrl');
    const apiKey = this.configService.get<string>('ipg.apiKey');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-IPG-Api-Key': apiKey ?? '',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ServiceUnavailableException(
        'The payment gateway is unreachable',
      );
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ServiceUnavailableException(
        data?.message ?? 'The payment gateway rejected the request',
      );
    }
    return data as T;
  }
}
