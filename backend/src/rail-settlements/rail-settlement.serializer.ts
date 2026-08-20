import { RailSettlement } from './entities/rail-settlement.entity';

export function serializeRailSettlement(settlement: RailSettlement) {
  return {
    id: settlement.id,
    walletId: settlement.walletId,
    railType: settlement.railType,
    amount: settlement.amount,
    destinationIban: settlement.destinationIban,
    label: settlement.label,
    status: settlement.status,
    scheduledFor: settlement.scheduledFor,
    processedAt: settlement.processedAt,
    transactionId: settlement.transactionId,
    providerReference: settlement.providerReference,
    providerResponse: settlement.providerResponse,
    createdAt: settlement.createdAt,
  };
}
