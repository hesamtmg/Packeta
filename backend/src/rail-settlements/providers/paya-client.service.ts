import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  RailProviderClient,
  RailProviderSubmitRequest,
  RailProviderSubmitResult,
} from './rail-provider.interface';

// Mocked until CBI/the bank gives us real Paya API credentials/spec — swap
// the body of submit() for a real HTTP call then. Paya is a batch ACH-style
// clearing rail, so the real API's response is expected to be a trace
// number queued into the next settlement batch rather than an immediate
// final status; the mock models that shape without a real queue.
@Injectable()
export class PayaClientService implements RailProviderClient {
  async submit(
    request: RailProviderSubmitRequest,
  ): Promise<RailProviderSubmitResult> {
    const providerReference = `MOCK-PAYA-${randomUUID()}`;
    return {
      success: true,
      providerReference,
      raw: {
        provider: 'PAYA',
        traceNumber: providerReference,
        status: 'QUEUED',
        amount: request.amount,
        destinationIban: request.destinationIban,
        submittedAt: new Date().toISOString(),
      },
    };
  }
}
