import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InstallmentsService } from '../installments/installments.service';

// Once a day: generates the next scheduled installment for every
// repository-backed credit wallet whose type's installmentDate matches
// today, then applies penalties and blocks any wallet whose installment
// missed its payment deadline — see InstallmentsService for both halves.
@Injectable()
export class InstallmentSweepService {
  private readonly logger = new Logger(InstallmentSweepService.name);

  constructor(private readonly installmentsService: InstallmentsService) {}

  @Cron('0 0 * * *')
  async sweep(): Promise<void> {
    const generated = await this.installmentsService.generateDue();
    if (generated.length) {
      this.logger.log(`Generated ${generated.length} installment(s)`);
    }

    const overdue = await this.installmentsService.applyOverduePenalties();
    if (overdue) {
      this.logger.log(`Applied overdue penalty to ${overdue} installment(s)`);
    }
  }
}
