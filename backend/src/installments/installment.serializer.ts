import { Installment } from './entities/installment.entity';
import { SpendDetail } from './installments.service';

export function serializeInstallment(
  installment: Installment,
  spendBreakdown: SpendDetail[] = [],
) {
  return {
    id: installment.id,
    walletId: installment.walletId,
    periodStart: installment.periodStart,
    periodEnd: installment.periodEnd,
    sequenceNumber: installment.sequenceNumber,
    amount: installment.amount,
    principalAmount: installment.principalAmount,
    penaltyApplied: installment.penaltyApplied,
    penaltyDaysApplied: installment.penaltyDaysApplied,
    dueDate: installment.dueDate,
    deadlineDate: installment.deadlineDate,
    status: installment.status,
    paidAt: installment.paidAt,
    paymentTransactionId: installment.paymentTransactionId,
    createdAt: installment.createdAt,
    spendBreakdown,
  };
}
