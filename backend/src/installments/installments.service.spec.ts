import { InstallmentsService } from './installments.service';
import { InstallmentStatus } from './entities/installment.entity';

function buildService(options: {
  wallets?: any[];
  existingByWallet?: Record<string, any[]>;
  overdueRows?: any[];
}) {
  const installmentsRepository = {
    find: jest.fn(
      async ({ where: { walletId } }: any) =>
        options.existingByWallet?.[walletId] ?? [],
    ),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (data: any) => ({ id: 'installment-1', ...data })),
    createQueryBuilder: jest.fn(() => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => options.overdueRows ?? []),
    })),
  };
  const walletsRepository = {
    update: jest.fn(async () => undefined),
    createQueryBuilder: jest.fn(() => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => options.wallets ?? []),
    })),
  };
  const service = new InstallmentsService(
    installmentsRepository as any,
    walletsRepository as any,
  );
  return { service, installmentsRepository, walletsRepository };
}

describe('InstallmentsService.computeInstallmentAmount', () => {
  const { service } = buildService({});

  it('splits evenly when the amount divides cleanly', () => {
    expect(service.computeInstallmentAmount(1000n, 4, 1, 0n)).toBe(250n);
    expect(service.computeInstallmentAmount(1000n, 4, 4, 0n)).toBe(250n);
  });

  it('folds the remainder into the last installment only', () => {
    // 1000 / 3 = 333 remainder 1
    expect(service.computeInstallmentAmount(1000n, 3, 1, 0n)).toBe(333n);
    expect(service.computeInstallmentAmount(1000n, 3, 2, 0n)).toBe(333n);
    expect(service.computeInstallmentAmount(1000n, 3, 3, 0n)).toBe(334n);
  });

  it('adds the flat fee on every installment, including the last', () => {
    expect(service.computeInstallmentAmount(1000n, 3, 1, 50n)).toBe(383n);
    expect(service.computeInstallmentAmount(1000n, 3, 3, 50n)).toBe(384n);
  });
});

describe('InstallmentsService.computeDeadlineDate', () => {
  const { service } = buildService({});

  it("uses the same month when the deadline day hasn't passed yet", () => {
    const dueDate = new Date(2026, 0, 5); // Jan 5
    const deadline = service.computeDeadlineDate(dueDate, 20);
    expect(deadline.getMonth()).toBe(0);
    expect(deadline.getDate()).toBe(20);
  });

  it('rolls into the next month when the deadline day already passed', () => {
    const dueDate = new Date(2026, 0, 25); // Jan 25
    const deadline = service.computeDeadlineDate(dueDate, 5);
    expect(deadline.getMonth()).toBe(1);
    expect(deadline.getDate()).toBe(5);
  });

  it('clamps a deadline day beyond the target month length', () => {
    // Jan 31 due date, deadline day 31: same-month candidate is also Jan 31
    // (not past due date, so it wouldn't roll on that basis alone) — but
    // since it equals dueDate exactly, it rolls into Feb, where day 31
    // clamps down to Feb's actual last day.
    const dueDate = new Date(2026, 0, 31); // Jan 31
    const deadline = service.computeDeadlineDate(dueDate, 31);
    expect(deadline.getMonth()).toBe(1);
    expect(deadline.getDate()).toBe(28); // Feb 2026 has 28 days
  });
});

describe('InstallmentsService.generateDue', () => {
  const wallet = {
    id: 'wallet-1',
    virtualAmount: '900',
    walletType: {
      installmentCount: 3,
      fee: '10',
      paymentDeadlineDate: 15,
    },
  };

  it('generates the next installment for an eligible wallet with none yet', async () => {
    const { service, installmentsRepository } = buildService({
      wallets: [wallet],
      existingByWallet: {},
    });

    const today = new Date(2026, 0, 1);
    const created = await service.generateDue(today);

    expect(created).toHaveLength(1);
    expect(installmentsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: 'wallet-1',
        sequenceNumber: 1,
        amount: '310', // 900/3 + fee 10
        status: InstallmentStatus.PENDING,
      }),
    );
  });

  it('skips a wallet that already has every installment generated', async () => {
    const { service, installmentsRepository } = buildService({
      wallets: [wallet],
      existingByWallet: {
        'wallet-1': [
          { dueDate: '2025-11-01' },
          { dueDate: '2025-12-01' },
          { dueDate: '2025-10-01' },
        ],
      },
    });

    const created = await service.generateDue(new Date(2026, 0, 1));

    expect(created).toHaveLength(0);
    expect(installmentsRepository.create).not.toHaveBeenCalled();
  });

  it("is idempotent within the same day (doesn't double-generate)", async () => {
    const { service, installmentsRepository } = buildService({
      wallets: [wallet],
      existingByWallet: {
        'wallet-1': [{ dueDate: '2026-01-01' }],
      },
    });

    const created = await service.generateDue(new Date(2026, 0, 1));

    expect(created).toHaveLength(0);
    expect(installmentsRepository.create).not.toHaveBeenCalled();
  });
});

describe('InstallmentsService.applyOverduePenalties', () => {
  it('adds the penalty, marks OVERDUE, and blocks a not-yet-blocked wallet', async () => {
    const row = {
      id: 'installment-1',
      amount: '300',
      penaltyApplied: false,
      status: InstallmentStatus.PENDING,
      wallet: {
        id: 'wallet-1',
        blockedAt: null,
        walletType: { penalty: '25' },
      },
    };
    const { service, installmentsRepository, walletsRepository } = buildService(
      { overdueRows: [row] },
    );

    const count = await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(count).toBe(1);
    expect(row.amount).toBe('325');
    expect(row.status).toBe(InstallmentStatus.OVERDUE);
    expect(row.penaltyApplied).toBe(true);
    expect(installmentsRepository.save).toHaveBeenCalledWith(row);
    expect(walletsRepository.update).toHaveBeenCalledWith(
      'wallet-1',
      expect.objectContaining({ blockedAt: expect.any(Date) }),
    );
  });

  it('does not re-block a wallet that is already blocked', async () => {
    const row = {
      id: 'installment-2',
      amount: '300',
      penaltyApplied: false,
      status: InstallmentStatus.PENDING,
      wallet: {
        id: 'wallet-2',
        blockedAt: new Date(2026, 0, 10),
        walletType: { penalty: '25' },
      },
    };
    const { service, walletsRepository } = buildService({
      overdueRows: [row],
    });

    await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(walletsRepository.update).not.toHaveBeenCalled();
  });
});
