import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InstallmentsService } from '../installments/installments.service';
import { LoggingService } from '../logging/logging.service';
import { Interval } from '@nestjs/schedule';
import { InstallmentActivityEvent, RealtimeEvent } from '../realtime/events';

// Installments are no longer generated here — each credit-funded purchase
// gets its own plan the moment it settles (see
// InstallmentsService.createForPurchase). This sweep only re-checks them:
// first every installment whose due date has arrived (see
// checkDueInstallments — cancels it if its purchase was refunded meanwhile,
// otherwise logs it as due), then penalties and blocking for anything past
// its payment deadline (see applyOverduePenalties). Runs often, but both
// halves are idempotent, so each installment is handled once per day.
@Injectable()
export class InstallmentSweepService {
  private readonly logger = new Logger(InstallmentSweepService.name);

  constructor(
    private readonly installmentsService: InstallmentsService,
    private readonly loggingService: LoggingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Interval(30_000)
  async sweep(): Promise<void> {
    const { due, canceled } =
      await this.installmentsService.checkDueInstallments();
    if (due.length || canceled.length) {
      this.logger.log(
        `Checked ${due.length + canceled.length} due installment(s): ${due.length} due, ${canceled.length} canceled`,
      );
      await this.loggingService.log({
        category: 'SCHEDULER',
        action: 'installment_due_check',
        success: true,
        metadata: {
          dueCount: due.length,
          canceledCount: canceled.length,
          installments: [...due, ...canceled].map((installment) => ({
            id: installment.id,
            walletId: installment.walletId,
            purchaseTransactionId: installment.purchaseTransactionId,
            amount: installment.amount,
            sequenceNumber: installment.sequenceNumber,
            dueDate: installment.dueDate,
            status: installment.status,
          })),
        },
      });
      const event: InstallmentActivityEvent = {
        kind: 'due',
        count: due.length + canceled.length,
        installmentIds: [...due, ...canceled].map((i) => i.id),
        at: new Date().toISOString(),
      };
      this.eventEmitter.emit(RealtimeEvent.INSTALLMENT_ACTIVITY, event);
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
      const event: InstallmentActivityEvent = {
        kind: 'overdue_penalty',
        count: overdue,
        at: new Date().toISOString(),
      };
      this.eventEmitter.emit(RealtimeEvent.INSTALLMENT_ACTIVITY, event);
    }
  }
}
