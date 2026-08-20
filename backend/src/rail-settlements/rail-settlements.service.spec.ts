import { RailSettlementsService } from './rail-settlements.service';
import {
  RailSettlementStatus,
  SettlementRailType,
} from './entities/rail-settlement.entity';

function buildService(overrides?: { submit?: jest.Mock }) {
  const submit =
    overrides?.submit ??
    jest.fn().mockResolvedValue({
      success: true,
      providerReference: 'MOCK-REF-1',
      raw: { status: 'OK' },
    });
  const client = { submit };

  const manager = {
    create: jest.fn((_entity, data) => ({ id: 'settlement-1', ...data })),
    save: jest.fn((entity) => Promise.resolve(entity)),
  } as any;

  const service = new RailSettlementsService(
    {} as any,
    client as any,
    client as any,
    client as any,
    client as any,
  );

  return { service, manager, client };
}

describe('RailSettlementsService.createForSweep', () => {
  const baseInput = {
    walletId: 'wallet-1',
    railType: SettlementRailType.SATNA,
    amount: '1000',
    destinationIban: 'IR000000000000000000000001',
    label: null,
    transactionId: 'tx-1',
    scheduledFor: new Date('2026-01-01T10:30:00Z'),
  };

  it('calls the rail provider client and persists its mocked reference/response', async () => {
    const { service, manager, client } = buildService();

    const settlement = await service.createForSweep(manager, baseInput);

    expect(client.submit).toHaveBeenCalledWith({
      railSettlementId: 'settlement-1',
      walletId: 'wallet-1',
      amount: '1000',
      destinationIban: 'IR000000000000000000000001',
      label: null,
    });
    expect(settlement.providerReference).toBe('MOCK-REF-1');
    expect(settlement.providerResponse).toEqual({ status: 'OK' });
    expect(settlement.status).toBe(RailSettlementStatus.COMPLETED);
    expect(settlement.processedAt).toBeInstanceOf(Date);
    expect(manager.save).toHaveBeenCalledTimes(2);
  });

  it('marks the settlement FAILED when the provider reports failure', async () => {
    const submit = jest.fn().mockResolvedValue({
      success: false,
      providerReference: 'MOCK-REF-2',
      raw: { status: 'REJECTED' },
    });
    const { service, manager } = buildService({ submit });

    const settlement = await service.createForSweep(manager, baseInput);

    expect(settlement.status).toBe(RailSettlementStatus.FAILED);
    expect(settlement.providerReference).toBe('MOCK-REF-2');
  });
});
