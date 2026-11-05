import { ServiceUnavailableException } from '@nestjs/common';
import {
  SadadClientService,
  decodeSadadKey,
  sadadLocalDateTime,
  sadadSignData,
} from './sadad-client.service';

// Vectors produced by Sadad's C# MakeSign (TripleDES, ECB, PKCS7, UTF8).
const KEY = 'prK/jNrK/zPp/lASBVyCRFMcx8y5dFUi';

function buildService(config: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    'sadad.merchantId': '000000140000000',
    'sadad.terminalId': '24095674',
    'sadad.terminalKey': KEY,
    'sadad.apiBaseUrl': 'https://sadad.shaparak.ir',
    'sadad.purchaseBaseUrl': 'https://sadad.shaparak.ir',
    'sadad.amountMultiplier': 10,
    ...config,
  };
  const configService = { get: jest.fn((key: string) => values[key]) };
  return new SadadClientService(configService as any);
}

function mockFetch(body: unknown) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue({ json: async () => body } as any);
}

describe('Sadad signing helpers', () => {
  it('matches the C# MakeSign output byte for byte', () => {
    expect(sadadSignData('24095674;1001;1250000', KEY)).toBe(
      '6/5zC6mPoyX0bTyaKyBo28AbIERIj9oP',
    );
    expect(sadadSignData('24095674;987654321;124950000', KEY)).toBe(
      '6/5zC6mPoyU9i1EwGfOWDTPWTvjpo53NWyj345RzM1E=',
    );
    expect(sadadSignData('8D2F1C77A4E09B3C5D6E7F80', KEY)).toBe(
      '2/S4taCdoFSFV9wGlJn0MHPcZ7xCMJ5L78k++F3Hk7E=',
    );
  });

  it('rejects keys that are not Base64 of 24 bytes', () => {
    expect(() => decodeSadadKey('not base64!')).toThrow(/Base64/);
    expect(() => decodeSadadKey(Buffer.alloc(16).toString('base64'))).toThrow(
      /24 bytes/,
    );
    expect(decodeSadadKey(` ${KEY}\n`).length).toBe(24);
  });

  it('formats LocalDateTime in Tehran time', () => {
    expect(sadadLocalDateTime(new Date('2026-03-20T20:30:00Z'))).toBe(
      '03/21/2026 12:00:00 AM',
    );
    expect(sadadLocalDateTime(new Date('2026-07-01T10:15:05Z'))).toBe(
      '07/01/2026 01:45:05 PM',
    );
  });
});

describe('SadadClientService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports missing credentials', () => {
    expect(
      buildService({ 'sadad.terminalKey': '' }).configurationError(),
    ).toMatch(/must be set/);
    expect(buildService().configurationError()).toBeNull();
  });

  it('sends a signed PaymentRequest in Rial and returns the purchase url', async () => {
    const fetchSpy = mockFetch({ ResCode: 0, Token: 'tok-123' });
    const result = await buildService().createPayment({
      merchantName: 'Deposit',
      amount: '12500',
      displayAmount: '12,500',
      callbackUrl: 'https://packeta.ir/api/payment-gateway/sadad/return?x=1',
      timeoutSeconds: 900,
    });

    expect(result.authority).toBe('tok-123');
    expect(result.paymentUrl).toBe(
      'https://sadad.shaparak.ir/VPG/Purchase?Token=tok-123',
    );
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://sadad.shaparak.ir/vpg/api/v0/Request/PaymentRequest',
    );
    const body = JSON.parse(init.body as string);
    expect(body.Amount).toBe(125000);
    expect(body.TerminalId).toBe('24095674');
    expect(body.OrderId).toMatch(/^\d+$/);
    expect(body.SignData).toBe(
      sadadSignData(`24095674;${body.OrderId};125000`, KEY),
    );
    expect(body.ReturnUrl).toBe(
      'https://packeta.ir/api/payment-gateway/sadad/return?x=1',
    );
  });

  it('throws with the ResCode when Sadad rejects the request', async () => {
    mockFetch({ ResCode: 1025, Description: 'bad sign' });
    await expect(
      buildService().createPayment({
        merchantName: 'Deposit',
        amount: '100',
        displayAmount: '100',
        callbackUrl: 'https://x',
        timeoutSeconds: 900,
      }),
    ).rejects.toThrow(/1025/);
  });

  it('refuses to create a payment when not configured', async () => {
    await expect(
      buildService({ 'sadad.merchantId': '' }).createPayment({
        merchantName: 'Deposit',
        amount: '100',
        displayAmount: '100',
        callbackUrl: 'https://x',
        timeoutSeconds: 900,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('verifies a payment with a signed token', async () => {
    const fetchSpy = mockFetch({
      ResCode: 0,
      Amount: 125000,
      RetrivalRefNo: '998877',
      SystemTraceNo: '112233',
    });
    const result = await buildService().verifyPayment('tok-123', '12500');

    expect(result).toEqual({ success: true, refId: '998877' });
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toEqual({
      Token: 'tok-123',
      SignData: sadadSignData('tok-123', KEY),
    });
  });

  it('fails verification when the amount differs', async () => {
    mockFetch({ ResCode: 0, Amount: 1000 });
    const result = await buildService().verifyPayment('tok-123', '12500');
    expect(result.success).toBe(false);
  });

  it('fails verification on a non-zero ResCode', async () => {
    mockFetch({ ResCode: -1, Description: 'not paid' });
    const result = await buildService().verifyPayment('tok-123', '12500');
    expect(result).toEqual({
      success: false,
      reason: 'not paid [ResCode: -1]',
    });
  });
});
