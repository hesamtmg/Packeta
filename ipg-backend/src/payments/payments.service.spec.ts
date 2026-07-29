import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentsService } from './payments.service';
import {
  PaymentIntent,
  PaymentIntentStatus,
} from './entities/payment-intent.entity';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let store: Map<string, PaymentIntent>;
  let idCounter: number;

  beforeEach(async () => {
    store = new Map();
    idCounter = 0;

    const repositoryMock = {
      create: (data: Partial<PaymentIntent>) => ({ ...data }) as PaymentIntent,
      save: async (intent: PaymentIntent) => {
        if (!intent.id) {
          intent.id = `intent-${++idCounter}`;
        }
        store.set(intent.id, intent);
        return intent;
      },
      findOne: async ({ where: { id } }: { where: { id: string } }) =>
        store.get(id) ?? null,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(PaymentIntent),
          useValue: repositoryMock,
        },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:5174' },
        },
      ],
    }).compile();

    service = moduleRef.get(PaymentsService);
  });

  it('creates a payment intent and returns a pay-page URL', async () => {
    const result = await service.create({
      merchantName: 'Acme Store',
      amount: 1000,
      displayAmount: '$10.00',
      callbackUrl: 'http://localhost:5173/purchase/abc/callback',
    });
    expect(result.paymentUrl).toBe(
      `http://localhost:5174/pay/${result.authority}`,
    );
  });

  it('confirm -> verify succeeds exactly once', async () => {
    const { authority } = await service.create({
      merchantName: 'Acme Store',
      amount: 1000,
      displayAmount: '$10.00',
      callbackUrl: 'http://localhost:5173/purchase/abc/callback',
    });

    const { redirectUrl } = await service.confirm(authority);
    expect(redirectUrl).toContain('status=success');

    const first = await service.verify(authority, 1000);
    expect(first.success).toBe(true);

    const second = await service.verify(authority, 1000);
    expect(second.success).toBe(false);
  });

  it('rejects verify with a mismatched amount', async () => {
    const { authority } = await service.create({
      merchantName: 'Acme Store',
      amount: 1000,
      displayAmount: '$10.00',
      callbackUrl: 'http://localhost:5173/purchase/abc/callback',
    });
    await service.confirm(authority);

    const result = await service.verify(authority, 500);
    expect(result).toEqual({ success: false, reason: 'amount mismatch' });
  });

  it('rejects verify before the customer has confirmed', async () => {
    const { authority } = await service.create({
      merchantName: 'Acme Store',
      amount: 1000,
      displayAmount: '$10.00',
      callbackUrl: 'http://localhost:5173/purchase/abc/callback',
    });

    const result = await service.verify(authority, 1000);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not authorized');
  });

  it('treats a past-due intent as expired and blocks confirm', async () => {
    const { authority } = await service.create({
      merchantName: 'Acme Store',
      amount: 1000,
      displayAmount: '$10.00',
      callbackUrl: 'http://localhost:5173/purchase/abc/callback',
      timeoutSeconds: 30,
    });
    store.get(authority)!.expiresAt = new Date(Date.now() - 1000);

    await expect(service.confirm(authority)).rejects.toThrow();
    const publicView = await service.getPublic(authority);
    expect(publicView.status).toBe(PaymentIntentStatus.EXPIRED);
  });
});
