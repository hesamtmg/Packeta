import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TransactionsService } from '../transactions/transactions.service';
import { LoggingService } from '../logging/logging.service';

// The auto-reversal half of the two-phase purchase flow: any PENDING
// PURCHASE whose expiresAt has passed without the merchant verifying it is
// marked REVERSED. No balance to unwind — nothing moves until /verify
// succeeds, so this is purely a status change.
@Injectable()
export class PurchaseTimeoutSweepService {
  private readonly logger = new Logger(PurchaseTimeoutSweepService.name);

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly loggingService: LoggingService,
  ) {}

  @Interval(30_000)
  async sweep(): Promise<void> {
    console.log('PurchaseTimeoutSweepService');
    const expired =
      await this.transactionsService.findExpiredPendingPurchases();
    for (const transaction of expired) {
      await this.transactionsService.expirePendingPurchase(transaction.id);
      this.logger.log(`Reversed expired purchase ${transaction.id}`);
      await this.loggingService.log({
        category: 'SCHEDULER',
        action: 'purchase_timeout_reverse',
        success: true,
        metadata: { transactionId: transaction.id },
      });
    }
  }
}
