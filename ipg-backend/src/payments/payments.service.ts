import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PaymentIntent,
  PaymentIntentStatus,
} from './entities/payment-intent.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentIntent)
    private readonly paymentsRepository: Repository<PaymentIntent>,
    private readonly configService: ConfigService,
  ) {}

  async create(
    dto: CreatePaymentDto,
  ): Promise<{ authority: string; paymentUrl: string }> {
    const timeoutSeconds = dto.timeoutSeconds ?? 900;
    const intent = this.paymentsRepository.create({
      merchantName: dto.merchantName,
      amount: String(dto.amount),
      displayAmount: dto.displayAmount,
      callbackUrl: dto.callbackUrl,
      status: PaymentIntentStatus.INITIATED,
      expiresAt: new Date(Date.now() + timeoutSeconds * 1000),
    });
    const saved = await this.paymentsRepository.save(intent);
    const frontendUrl = this.configService.get<string>('frontendUrl');
    return {
      authority: saved.id,
      paymentUrl: `${frontendUrl}/pay/${saved.id}`,
    };
  }

  async getPublic(authority: string) {
    const intent = await this.findOrThrow(authority);
    const status = this.effectiveStatus(intent);
    return {
      merchantName: intent.merchantName,
      displayAmount: intent.displayAmount,
      status,
      expiresAt: intent.expiresAt,
    };
  }

  async confirm(authority: string): Promise<{ redirectUrl: string }> {
    const intent = await this.findOrThrow(authority);
    this.assertActionable(intent);

    intent.status = PaymentIntentStatus.AUTHORIZED;
    intent.authorizedAt = new Date();
    await this.paymentsRepository.save(intent);

    return { redirectUrl: this.buildRedirect(intent, 'success') };
  }

  async cancel(authority: string): Promise<{ redirectUrl: string }> {
    const intent = await this.findOrThrow(authority);
    this.assertActionable(intent);

    intent.status = PaymentIntentStatus.CANCELED;
    await this.paymentsRepository.save(intent);

    return { redirectUrl: this.buildRedirect(intent, 'canceled') };
  }

  // Server-to-server, called by the merchant (Packeta backend) after the
  // customer's browser lands back on the callback URL. One-time: a second
  // call against an already-VERIFIED intent fails, same as a real gateway.
  async verify(
    authority: string,
    expectedAmount?: number,
  ): Promise<{ success: boolean; reason?: string; refId?: string }> {
    const intent = await this.findOrThrow(authority);
    const status = this.effectiveStatus(intent);

    if (status === PaymentIntentStatus.EXPIRED) {
      if (intent.status !== PaymentIntentStatus.EXPIRED) {
        intent.status = PaymentIntentStatus.EXPIRED;
        await this.paymentsRepository.save(intent);
      }
      return { success: false, reason: 'expired' };
    }
    if (status !== PaymentIntentStatus.AUTHORIZED) {
      return { success: false, reason: `not authorized (status: ${status})` };
    }
    if (
      expectedAmount !== undefined &&
      String(expectedAmount) !== intent.amount
    ) {
      return { success: false, reason: 'amount mismatch' };
    }

    intent.status = PaymentIntentStatus.VERIFIED;
    intent.verifiedAt = new Date();
    await this.paymentsRepository.save(intent);

    return { success: true, refId: intent.id };
  }

  private async findOrThrow(authority: string): Promise<PaymentIntent> {
    const intent = await this.paymentsRepository.findOne({
      where: { id: authority },
    });
    if (!intent) {
      throw new NotFoundException('Payment not found');
    }
    return intent;
  }

  // INITIATED rows past their expiry are treated as EXPIRED without needing
  // a background sweep — this sandbox only has one state to lazily derive.
  private effectiveStatus(intent: PaymentIntent): PaymentIntentStatus {
    if (
      intent.status === PaymentIntentStatus.INITIATED &&
      intent.expiresAt.getTime() < Date.now()
    ) {
      return PaymentIntentStatus.EXPIRED;
    }
    return intent.status;
  }

  private assertActionable(intent: PaymentIntent): void {
    const status = this.effectiveStatus(intent);
    if (status === PaymentIntentStatus.EXPIRED) {
      throw new GoneException('This payment has expired');
    }
    if (status !== PaymentIntentStatus.INITIATED) {
      throw new GoneException(
        `This payment was already resolved (status: ${status})`,
      );
    }
  }

  private buildRedirect(
    intent: PaymentIntent,
    outcome: 'success' | 'canceled',
  ): string {
    const separator = intent.callbackUrl.includes('?') ? '&' : '?';
    return `${intent.callbackUrl}${separator}authority=${intent.id}&status=${outcome}`;
  }
}
