import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  RailProviderClient,
  RailProviderSubmitRequest,
  RailProviderSubmitResult,
} from './rail-provider.interface';

// Mocked until Pol Pay gives us real API credentials/spec — swap the body
// of submit() for a real HTTP call then, keeping the same
// RailProviderClient contract. Pol Pay is a near-real-time PSP bridge, so
// the mock always resolves immediately with an ACCEPTED status rather than
// modeling a pending/async settlement.
@Injectable()
export class PolPayClientService implements RailProviderClient {
  async submit(
    request: RailProviderSubmitRequest,
  ): Promise<RailProviderSubmitResult> {
    const providerReference = `MOCK-POLPAY-${randomUUID()}`;
    return {
      success: true,
      providerReference,
      raw: {
        provider: 'POL_PAY',
        transactionId: providerReference,
        status: 'ACCEPTED',
        amount: request.amount,
        destinationIban: request.destinationIban,
        submittedAt: new Date().toISOString(),
      },
    };
  }
}
