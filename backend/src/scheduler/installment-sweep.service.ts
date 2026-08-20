import { Injectable, Logger } from '@nestjs/common';
import { InstallmentsService } from '../installments/installments.service';
import { LoggingService } from '../logging/logging.service';
import { Interval } from '@nestjs/schedule';
// Once a day: generates the next scheduled installment for every
// repository-backed credit wallet whose type's installmentDate matches
// today, then applies penalties and blocks any wallet whose installment
// missed its payment deadline — see InstallmentsService for both halves.
@Injectable()
export class InstallmentSweepService {
  private readonly logger = new Logger(InstallmentSweepService.name);

  constructor(
    private readonly installmentsService: InstallmentsService,
    private readonly loggingService: LoggingService,
  ) {}

  @Interval(30_000)
  async sweep(): Promise<void> {
    console.log('InstallmentSweepService');
    const generated = await this.installmentsService.generateDue();
    if (generated.length) {
      this.logger.log(`Generated ${generated.length} installment(s)`);
      await this.loggingService.log({
        category: 'SCHEDULER',
        action: 'installment_generate',
        success: true,
        metadata: {
          count: generated.length,
          installments: generated.map((installment) => ({
            id: installment.id,
            walletId: installment.walletId,
            amount: installment.amount,
            sequenceNumber: installment.sequenceNumber,
          })),
        },
      });
    }

    const overdue = await this.installmentsService.applyOverduePenalties();
    if (overdue) {
      this.logger.log(`Applied overdue penalty to ${overdue} installment(s)`);
      await this.loggingService.log({
        category: 'SCHEDULER',
        action: 'installment_overdue_penalty',
        success: true,
        metadata: { count: overdue },
      });
    }
  }
}
