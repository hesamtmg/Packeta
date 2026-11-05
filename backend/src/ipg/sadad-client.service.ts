import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, randomInt } from 'crypto';
import { CreateIpgPaymentInput, IpgVerifyResult } from './ipg-client.service';

export const SADAD_LIVE_URL = 'https://sadad.shaparak.ir';

interface SadadPaymentRequestResponse {
  ResCode?: number | string;
  Token?: string;
  Description?: string;
}

interface SadadVerifyResponse {
  ResCode?: number | string;
  Amount?: number | string;
  Description?: string;
  RetrivalRefNo?: string | number; // sic: Sadad's spelling
  SystemTraceNo?: string | number;
  OrderId?: string | number;
}

// Decodes Sadad's Base64 TerminalKey; real keys are exactly 24 bytes
// (TripleDES). Whitespace from copy-pasting the key is ignored.
export function decodeSadadKey(terminalKeyBase64: string): Buffer {
  const clean = String(terminalKeyBase64 ?? '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) {
    throw new Error('SADAD_TERMINAL_KEY is not valid Base64');
  }
  const key = Buffer.from(clean, 'base64');
  if (key.length !== 24) {
    throw new Error(
      `SADAD_TERMINAL_KEY must decode to 24 bytes, got ${key.length}`,
    );
  }
  return key;
}

// SignData = Base64(TripleDES-ECB-PKCS7(text, key)) — byte-for-byte the same
// as Sadad's C# MakeSign sample (see sadad-client.service.spec.ts vectors).
export function sadadSignData(text: string, terminalKeyBase64: string): string {
  const cipher = createCipheriv('des-ede3', decodeSadadKey(terminalKeyBase64), null);
  cipher.setAutoPadding(true);
  return Buffer.concat([
    cipher.update(String(text), 'utf8'),
    cipher.final(),
  ]).toString('base64');
}

// "MM/dd/yyyy hh:mm:ss AM" in Tehran time, the format Sadad expects for
// PaymentRequest's LocalDateTime.
export function sadadLocalDateTime(date: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second} ${String(parts.dayPeriod).toUpperCase()}`;
}

// Sadad rejects a reused OrderId, and it must be numeric — so every payment
// attempt gets a fresh one: epoch millis × 1000 + 3 random digits (stays
// well inside Number.MAX_SAFE_INTEGER and Sadad's Int64 OrderId).
export function newSadadOrderId(now: number = Date.now()): string {
  return (now * 1000 + randomInt(0, 1000)).toString();
}

// Real-money client for Sadad, Bank Melli's PSP (https://sadad.shaparak.ir)
// — the second gateway real-money flows (deposits, installment repayments,
// collections, support top-ups) can go through, next to ZarinPal. Which one
// is used is chosen by a super-admin, see PaymentGatewayService.
//
// Flow: PaymentRequest (SignData = TripleDES("TerminalId;OrderId;Amount"))
// → customer's browser to /VPG/Purchase?Token=… → Sadad POSTs the customer
// back to ReturnUrl (handled by SadadReturnController, which turns that POST
// into the same GET-with-Status redirect ZarinPal does) → Verify
// (SignData = TripleDES(Token)).
//
// Sadad speaks Rial. Wallet amounts are passed to ZarinPal as Toman, so by
// default they are multiplied by SADAD_AMOUNT_MULTIPLIER=10 here; set it to
// 1 if wallet amounts are already in Rial.
@Injectable()
export class SadadClientService {
  constructor(private readonly configService: ConfigService) {}

  // Whether credentials are present and well-formed — the admin panel won't
  // let a super-admin switch to Sadad until this is true.
  configurationError(): string | null {
    const { merchantId, terminalId, terminalKey } = this.credentials();
    if (!merchantId || !terminalId || !terminalKey) {
      return 'SADAD_MERCHANT_ID, SADAD_TERMINAL_ID and SADAD_TERMINAL_KEY must be set';
    }
    if (!/^\d+$/.test(merchantId)) return 'SADAD_MERCHANT_ID must be digits only';
    if (!/^\d+$/.test(terminalId)) return 'SADAD_TERMINAL_ID must be digits only';
    try {
      decodeSadadKey(terminalKey);
    } catch (err) {
      return (err as Error).message;
    }
    return null;
  }

  toRial(amount: string | number): number {
    return Math.round(Number(amount)) * this.multiplier();
  }

  async createPayment(
    input: CreateIpgPaymentInput,
  ): Promise<{ authority: string; paymentUrl: string; orderId: string }> {
    const configError = this.configurationError();
    if (configError) {
      throw new ServiceUnavailableException(
        `Sadad is not configured: ${configError}`,
      );
    }
    const { merchantId, terminalId, terminalKey } = this.credentials();
    const amount = this.toRial(input.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ServiceUnavailableException(
        'Sadad amount must be a positive whole number of Rial',
      );
    }
    const orderId = newSadadOrderId();

    const response = await this.request<SadadPaymentRequestResponse>(
      '/vpg/api/v0/Request/PaymentRequest',
      {
        TerminalId: terminalId,
        MerchantId: merchantId,
        Amount: amount,
        SignData: sadadSignData(`${terminalId};${orderId};${amount}`, terminalKey),
        ReturnUrl: input.callbackUrl,
        LocalDateTime: sadadLocalDateTime(),
        OrderId: orderId,
      },
    );

    const resCode = String(response.ResCode ?? '');
    if (resCode !== '0' || !response.Token) {
      throw new ServiceUnavailableException(
        `${response.Description || 'Sadad rejected the payment request'} [ResCode: ${resCode || 'none'}]`,
      );
    }

    const token = String(response.Token);
    return {
      authority: token,
      paymentUrl: `${this.purchaseBaseUrl()}/VPG/Purchase?Token=${encodeURIComponent(token)}`,
      orderId,
    };
  }

  async verifyPayment(
    token: string,
    expectedAmount: string,
  ): Promise<IpgVerifyResult> {
    const { terminalKey } = this.credentials();
    const response = await this.request<SadadVerifyResponse>(
      '/vpg/api/v0/Advice/Verify',
      { Token: token, SignData: sadadSignData(token, terminalKey) },
    );

    const resCode = String(response.ResCode ?? '');
    if (resCode !== '0') {
      return {
        success: false,
        reason: `${response.Description || 'Sadad declined the payment'} [ResCode: ${resCode || 'none'}]`,
      };
    }
    // Verify succeeded but for a different amount than this transaction —
    // never credit it (same rule as the reference sadad-node app).
    if (
      response.Amount !== undefined &&
      response.Amount !== null &&
      Number(response.Amount) !== this.toRial(expectedAmount)
    ) {
      return {
        success: false,
        reason: 'Sadad verified a different amount than this transaction',
      };
    }
    const refId = response.RetrivalRefNo ?? response.SystemTraceNo;
    return {
      success: true,
      refId: refId !== undefined && refId !== null ? String(refId) : undefined,
    };
  }

  private credentials() {
    return {
      merchantId: (this.configService.get<string>('sadad.merchantId') ?? '').trim(),
      terminalId: (this.configService.get<string>('sadad.terminalId') ?? '').trim(),
      terminalKey: (this.configService.get<string>('sadad.terminalKey') ?? '').trim(),
    };
  }

  private multiplier(): number {
    const value = Number(this.configService.get('sadad.amountMultiplier') ?? 10);
    return Number.isFinite(value) && value > 0 ? value : 10;
  }

  private apiBaseUrl(): string {
    return (this.configService.get<string>('sadad.apiBaseUrl') || SADAD_LIVE_URL).replace(/\/+$/, '');
  }

  private purchaseBaseUrl(): string {
    return (this.configService.get<string>('sadad.purchaseBaseUrl') || SADAD_LIVE_URL).replace(/\/+$/, '');
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.apiBaseUrl()}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ServiceUnavailableException('Sadad is unreachable');
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      throw new ServiceUnavailableException(
        'Sadad returned an unreadable response',
      );
    }
    return data as T;
  }
}
