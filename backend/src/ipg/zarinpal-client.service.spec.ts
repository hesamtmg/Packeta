import { ServiceUnavailableException } from '@nestjs/common';
import { ZarinpalClientService } from './zarinpal-client.service';

function buildService(config: Record<string, string> = {}) {
  const values: Record<string, string> = {
    'zarinpal.baseUrl': 'https://sandbox.zarinpal.com',
    'zarinpal.merchantId': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    ...config,
  };
  const configService = { get: jest.fn((key: string) => values[key]) };
  return new ZarinpalClientService(configService as any);
}

describe('ZarinpalClientService.createPayment', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the authority and a StartPay redirect url on success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({
        data: { code: 100, message: 'Success', authority: 'auth-abc' },
        errors: [],
      }),
    } as any);
    const service = buildService();

    const result = await service.createPayment({
      merchantName: 'Deposit',
      amount: '10000',
      displayAmount: '$100.00',
      callbackUrl: 'http://localhost:5173/purchase/tx-1/callback',
      timeoutSeconds: 900,
    });

    expect(result).toEqual({
      authority: 'auth-abc',
      paymentUrl: 'https://sandbox.zarinpal.com/pg/StartPay/auth-abc',
    });
  });

  it('throws when ZarinPal rejects the request', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({
        data: [],
        errors: { code: -9, message: 'Invalid amount' },
      }),
    } as any);
    const service = buildService();

    await expect(
      service.createPayment({
        merchantName: 'Deposit',
        amount: '10000',
        displayAmount: '$100.00',
        callbackUrl: 'http://localhost:5173/purchase/tx-1/callback',
        timeoutSeconds: 900,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('throws when ZarinPal is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const service = buildService();

    await expect(
      service.createPayment({
        merchantName: 'Deposit',
        amount: '10000',
        displayAmount: '$100.00',
        callbackUrl: 'http://localhost:5173/purchase/tx-1/callback',
        timeoutSeconds: 900,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('ZarinpalClientService.verifyPayment', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('succeeds on a freshly verified payment (code 100)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({
        data: { code: 100, message: 'Verified', ref_id: 123456 },
        errors: [],
      }),
    } as any);
    const service = buildService();

    const result = await service.verifyPayment('auth-abc', '10000');

    expect(result).toEqual({ success: true, refId: '123456' });
  });

  it('treats code 101 (already verified) as success too', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({
        data: { code: 101, message: 'Already verified', ref_id: 123456 },
        errors: [],
      }),
    } as any);
    const service = buildService();

    const result = await service.verifyPayment('auth-abc', '10000');

    expect(result.success).toBe(true);
  });

  it('reports failure with a reason when ZarinPal declines', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({
        data: [],
        errors: { code: -21, message: 'Payment not found' },
      }),
    } as any);
    const service = buildService();

    const result = await service.verifyPayment('auth-abc', '10000');

    expect(result).toEqual({ success: false, reason: 'Payment not found' });
  });
});
