import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  RailProviderClient,
  RailProviderSubmitRequest,
  RailProviderSubmitResult,
} from './rail-provider.interface';

// Mocked until we have a real API/credentials for whichever bank a given
// wallet's direct transfer goes out through — swap the body of submit() for
// a real HTTP call then. Bank-specific and not a CBI clearing rail, so the
// real integration (and its response shape) depends entirely on which bank
// this ends up being; the mock just models an initiated transfer awaiting
// the bank's own confirmation.
@Injectable()
export class BankTransferClientService implements RailProviderClient {
  async submit(
    request: RailProviderSubmitRequest,
  ): Promise<RailProviderSubmitResult> {
    const providerReference = `MOCK-BANKTRANSFER-${randomUUID()}`;
    return {
      success: true,
      providerReference,
      raw: {
        provider: 'BANK_TRANSFER',
        referenceCode: providerReference,
        status: 'INITIATED',
        amount: request.amount,
        destinationIban: request.destinationIban,
        submittedAt: new Date().toISOString(),
      },
    };
  }
}
