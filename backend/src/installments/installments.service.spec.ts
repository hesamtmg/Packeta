import { InstallmentsService } from './installments.service';
import { InstallmentStatus } from './entities/installment.entity';

function buildService(options: {
  wallets?: any[];
  existingBySourceTransaction?: Record<string, any[]>;
  overdueRows?: any[];
  grantsByWallet?: Record<string, any>;
}) {
  const installmentsRepository = {
    find: jest.fn(
      async ({ where: { sourceTransactionId } }: any) =>
        options.existingBySourceTransaction?.[sourceTransactionId] ?? [],
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
  const transactionsRepository = {
    findOne: jest.fn(
      async ({ where: { toWalletId } }: any) =>
        options.grantsByWallet?.[toWalletId] ?? null,
    ),
  };
  const service = new InstallmentsService(
    installmentsRepository as any,
    walletsRepository as any,
    transactionsRepository as any,
  );
  return {
    service,
    installmentsRepository,
    walletsRepository,
    transactionsRepository,
  };
}

describe('InstallmentsService.computeInstallmentPrincipal', () => {
  const { service } = buildService({});

  it('splits evenly when the amount divides cleanly', () => {
    expect(service.computeInstallmentPrincipal(1000n, 4, 1)).toBe(250n);
    expect(service.computeInstallmentPrincipal(1000n, 4, 4)).toBe(250n);
  });

  it('folds the remainder into the last installment only', () => {
    // 1000 / 3 = 333 remainder 1
    expect(service.computeInstallmentPrincipal(1000n, 3, 1)).toBe(333n);
    expect(service.computeInstallmentPrincipal(1000n, 3, 2)).toBe(333n);
    expect(service.computeInstallmentPrincipal(1000n, 3, 3)).toBe(334n);
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
    repositoryWalletId: 'repo-1',
    walletType: {
      installmentCount: 3,
      feePercent: '10',
      paymentDeadlineDate: 15,
    },
  };
  // The VIRTUAL transaction WalletsService.grantCredit recorded when this
  // wallet was granted its credit line — the fixed amount generateDue now
  // splits, instead of the wallet's live (and here deliberately absent)
  // virtualAmount.
  const grant = {
    id: 'grant-tx-1',
    fromWalletId: 'repo-1',
    toWalletId: 'wallet-1',
    amount: '900',
  };

  it('generates the next installment for an eligible wallet with none yet', async () => {
    const { service, installmentsRepository } = buildService({
      wallets: [wallet],
      grantsByWallet: { 'wallet-1': grant },
      existingBySourceTransaction: {},
    });

    const today = new Date(2026, 0, 1);
    const created = await service.generateDue(today);

    expect(created).toHaveLength(1);
    expect(installmentsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        walletId: 'wallet-1',
        sourceTransactionId: 'grant-tx-1',
        sequenceNumber: 1,
        principalAmount: '300', // 900/3
        amount: '330', // principal 300 + 10% fee (30)
        status: InstallmentStatus.PENDING,
      }),
    );
  });

  it('skips a wallet with no VIRTUAL grant transaction on record', async () => {
    const { service, installmentsRepository } = buildService({
      wallets: [wallet],
      grantsByWallet: {},
    });

    const created = await service.generateDue(new Date(2026, 0, 1));

    expect(created).toHaveLength(0);
    expect(installmentsRepository.create).not.toHaveBeenCalled();
  });

  it('skips a wallet that already has every installment generated', async () => {
    const { service, installmentsRepository } = buildService({
      wallets: [wallet],
      grantsByWallet: { 'wallet-1': grant },
      existingBySourceTransaction: {
        'grant-tx-1': [
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
      grantsByWallet: { 'wallet-1': grant },
      existingBySourceTransaction: {
        'grant-tx-1': [{ dueDate: '2026-01-01' }],
      },
    });

    const created = await service.generateDue(new Date(2026, 0, 1));

    expect(created).toHaveLength(0);
    expect(installmentsRepository.create).not.toHaveBeenCalled();
  });
});

describe('InstallmentsService.applyOverduePenalties', () => {
  it('adds 5 days worth of penalty, marks OVERDUE, and blocks a not-yet-blocked wallet', async () => {
    const row = {
      id: 'installment-1',
      amount: '1000',
      principalAmount: '1000',
      penaltyApplied: false,
      penaltyDaysApplied: 0,
      status: InstallmentStatus.PENDING,
      deadlineDate: '2026-01-15',
      wallet: {
        id: 'wallet-1',
        blockedAt: null,
        walletType: { penaltyPercentPerDay: '2' },
      },
    };
    const { service, installmentsRepository, walletsRepository } = buildService(
      { overdueRows: [row] },
    );

    // 5 days past deadline, 2%/day of the 1000 principal = 100
    const count = await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(count).toBe(1);
    expect(row.amount).toBe('1100');
    expect(row.penaltyDaysApplied).toBe(5);
    expect(row.status).toBe(InstallmentStatus.OVERDUE);
    expect(row.penaltyApplied).toBe(true);
    expect(installmentsRepository.save).toHaveBeenCalledWith(row);
    expect(walletsRepository.update).toHaveBeenCalledWith(
      'wallet-1',
      expect.objectContaining({ blockedAt: expect.any(Date) }),
    );
  });

  it('only charges the additional days owed on a run that follows an earlier one', async () => {
    const row = {
      id: 'installment-3',
      amount: '1040', // already charged 2 days (2 * 20) on an earlier run
      principalAmount: '1000',
      penaltyApplied: true,
      penaltyDaysApplied: 2,
      status: InstallmentStatus.OVERDUE,
      deadlineDate: '2026-01-15',
      wallet: {
        id: 'wallet-3',
        blockedAt: new Date(2026, 0, 17),
        walletType: { penaltyPercentPerDay: '2' },
      },
    };
    const { service } = buildService({ overdueRows: [row] });

    // Now 5 days past deadline — only 3 more days owed, not 5 again.
    await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(row.amount).toBe('1100');
    expect(row.penaltyDaysApplied).toBe(5);
  });

  it('is a no-op when penalty for every elapsed day was already applied', async () => {
    const row = {
      id: 'installment-4',
      amount: '1100',
      principalAmount: '1000',
      penaltyApplied: true,
      penaltyDaysApplied: 5,
      status: InstallmentStatus.OVERDUE,
      deadlineDate: '2026-01-15',
      wallet: {
        id: 'wallet-4',
        blockedAt: new Date(2026, 0, 17),
        walletType: { penaltyPercentPerDay: '2' },
      },
    };
    const { service, installmentsRepository } = buildService({
      overdueRows: [row],
    });

    const count = await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(count).toBe(0);
    expect(row.amount).toBe('1100');
    expect(installmentsRepository.save).not.toHaveBeenCalled();
  });

  it('does not re-block a wallet that is already blocked', async () => {
    const row = {
      id: 'installment-2',
      amount: '1000',
      principalAmount: '1000',
      penaltyApplied: false,
      penaltyDaysApplied: 0,
      status: InstallmentStatus.PENDING,
      deadlineDate: '2026-01-15',
      wallet: {
        id: 'wallet-2',
        blockedAt: new Date(2026, 0, 10),
        walletType: { penaltyPercentPerDay: '2' },
      },
    };
    const { service, walletsRepository } = buildService({
      overdueRows: [row],
    });

    await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(walletsRepository.update).not.toHaveBeenCalled();
  });
});

describe('InstallmentsService.markPaid', () => {
  function buildManager(installment: any, wallet: any) {
    return {
      update: jest.fn(async () => undefined),
      findOne: jest.fn(async (_entity: any, { where: { id } }: any) => {
        if (id === installment.id) return installment;
        if (id === wallet.id) return wallet;
        return null;
      }),
      create: jest.fn((_entity: any, data: any) => ({ ...data })),
      save: jest.fn(async (data: any) => data),
    };
  }

  it('marks the installment paid, clears the block, restores virtualAmount, and records a VIRTUAL restore transaction', async () => {
    const { service } = buildService({});
    const installment = {
      id: 'installment-1',
      walletId: 'wallet-1',
      amount: '330',
    };
    const wallet = { id: 'wallet-1', virtualAmount: '600' };
    const manager = buildManager(installment, wallet);

    await service.markPaid(manager as any, installment.id, 'tx-1');

    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'wallet-1', {
      blockedAt: null,
    });
    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'wallet-1', {
      virtualAmount: '930',
    });
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'VIRTUAL',
        fromWalletId: null,
        toWalletId: 'wallet-1',
        amount: '330',
        idempotencyKey: 'installment-restore:installment-1',
      }),
    );
  });

  it('restores from a null virtualAmount as if it were zero', async () => {
    const { service } = buildService({});
    const installment = {
      id: 'installment-2',
      walletId: 'wallet-2',
      amount: '250',
    };
    const wallet = { id: 'wallet-2', virtualAmount: null };
    const manager = buildManager(installment, wallet);

    await service.markPaid(manager as any, installment.id, 'tx-2');

    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'wallet-2', {
      virtualAmount: '250',
    });
  });
});
