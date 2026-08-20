import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  RailProviderClient,
  RailProviderSubmitRequest,
  RailProviderSubmitResult,
} from './rail-provider.interface';

// Mocked until CBI/the bank gives us real Satna API credentials/spec — swap
// the body of submit() for a real HTTP call then. Satna is CBI's RTGS, so
// unlike Paya it settles individually and immediately (no batch queue) —
// the mock reflects that with a SETTLED status and an RRN-style reference.
@Injectable()
export class SatnaClientService implements RailProviderClient {
  async submit(
    request: RailProviderSubmitRequest,
  ): Promise<RailProviderSubmitResult> {
    const providerReference = `MOCK-SATNA-${randomUUID()}`;
    return {
      success: true,
      providerReference,
      raw: {
        provider: 'SATNA',
        rrn: providerReference,
        status: 'SETTLED',
        amount: request.amount,
        destinationIban: request.destinationIban,
        submittedAt: new Date().toISOString(),
      },
    };
  }
}
