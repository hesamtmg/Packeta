import { BadRequestException } from '@nestjs/common';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentGatewayProvider } from './payment-gateway-provider';

function build({
  active,
  sadadError = null,
}: { active?: string; sadadError?: string | null } = {}) {
  const values: Record<string, string> = {
    'zarinpal.baseUrl': 'https://sandbox.zarinpal.com',
    'zarinpal.merchantId': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    backendPublicUrl: 'https://packeta.ir/api/',
    'jwt.secret': 'test-secret',
  };
  const configService = { get: jest.fn((key: string) => values[key]) };
  const repo = {
    findOne: jest
      .fn()
      .mockResolvedValue(active ? { key: 'k', value: active } : null),
    save: jest.fn(),
  };
  const zarinpal = {
    createPayment: jest
      .fn()
      .mockResolvedValue({ authority: 'z-1', paymentUrl: 'https://z/1' }),
    verifyPayment: jest.fn().mockResolvedValue({ success: true }),
  };
  const sadad = {
    configurationError: jest.fn().mockReturnValue(sadadError),
    createPayment: jest.fn().mockResolvedValue({
      authority: 's-1',
      paymentUrl: 'https://s/1',
      orderId: '1',
    }),
    verifyPayment: jest.fn().mockResolvedValue({ success: true }),
  };
  const service = new PaymentGatewayService(
    repo as any,
    configService as any,
    zarinpal as any,
    sadad as any,
  );
  return { service, repo, zarinpal, sadad };
}

const input = {
  merchantName: 'Deposit',
  amount: '100',
  displayAmount: '100',
  callbackUrl: 'https://packeta.ir/purchase/tx-1/callback',
  timeoutSeconds: 900,
};

describe('PaymentGatewayService', () => {
  it('defaults to ZarinPal when nothing is configured', async () => {
    const { service, zarinpal } = build();
    const result = await service.createPayment(input);
    expect(result.provider).toBe(PaymentGatewayProvider.ZARINPAL);
    expect(zarinpal.createPayment).toHaveBeenCalledWith(input);
  });

  it('routes to Sadad with a signed backend return url when Sadad is active', async () => {
    const { service, sadad } = build({ active: 'SADAD' });
    const result = await service.createPayment(input);

    expect(result).toEqual({
      authority: 's-1',
      paymentUrl: 'https://s/1',
      provider: PaymentGatewayProvider.SADAD,
    });
    const returnUrl = new URL(sadad.createPayment.mock.calls[0][0].callbackUrl);
    expect(returnUrl.origin + returnUrl.pathname).toBe(
      'https://packeta.ir/api/payment-gateway/sadad/return',
    );
    expect(returnUrl.searchParams.get('next')).toBe(input.callbackUrl);
  });

  it('turns a Sadad return into a ZarinPal-style redirect', () => {
    const { service } = build();
    const returnUrl = new URL(
      service.buildSadadReturnUrl(
        'https://pay.packeta.ir/widget/t/callback/tx-1?topupTxnId=tx-2',
      ),
    );
    const next = returnUrl.searchParams.get('next')!;
    const sig = returnUrl.searchParams.get('sig')!;

    const ok = new URL(service.resolveSadadReturn(next, sig, 'tok', '0'));
    expect(ok.searchParams.get('topupTxnId')).toBe('tx-2');
    expect(ok.searchParams.get('Authority')).toBe('tok');
    expect(ok.searchParams.get('Status')).toBe('OK');

    const canceled = new URL(service.resolveSadadReturn(next, sig, 'tok', '17'));
    expect(canceled.searchParams.get('Status')).toBe('NOK');
  });

  it('rejects a tampered return link', () => {
    const { service } = build();
    const returnUrl = new URL(service.buildSadadReturnUrl(input.callbackUrl));
    const sig = returnUrl.searchParams.get('sig')!;
    expect(() =>
      service.resolveSadadReturn('https://evil.example/', sig, 'tok', '0'),
    ).toThrow(BadRequestException);
  });

  it('verifies with the provider recorded on the transaction', async () => {
    const { service, sadad, zarinpal } = build({ active: 'ZARINPAL' });
    await service.verifyPayment('SADAD', 's-1', '100');
    expect(sadad.verifyPayment).toHaveBeenCalledWith('s-1', '100');
    await service.verifyPayment(null, 'z-1', '100');
    expect(zarinpal.verifyPayment).toHaveBeenCalledWith('z-1', '100');
  });

  it('refuses to activate Sadad until it is configured', async () => {
    const { service, repo } = build({ sadadError: 'missing creds' });
    await expect(
      service.setActiveProvider(PaymentGatewayProvider.SADAD, 'u-1'),
    ).rejects.toThrow(/missing creds/);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
