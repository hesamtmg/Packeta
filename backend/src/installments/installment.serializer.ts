import { Installment } from './entities/installment.entity';

export function serializeInstallment(installment: Installment) {
  return {
    id: installment.id,
    walletId: installment.walletId,
    sequenceNumber: installment.sequenceNumber,
    amount: installment.amount,
    penaltyApplied: installment.penaltyApplied,
    dueDate: installment.dueDate,
    deadlineDate: installment.deadlineDate,
    status: installment.status,
    paidAt: installment.paidAt,
    paymentTransactionId: installment.paymentTransactionId,
    createdAt: installment.createdAt,
  };
}
