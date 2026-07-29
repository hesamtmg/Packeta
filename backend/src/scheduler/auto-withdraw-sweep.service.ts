import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionsService } from '../transactions/transactions.service';

// Merchant wallets configure up to 3 "HH:MM" (server-local) times at which
// their full balance auto-sweeps out via a plain WITHDRAW. Runs once a
// minute and only acts on wallets whose schedule matches the current
// minute, so it's a no-op almost every tick.
@Injectable()
export class AutoWithdrawSweepService {
  private readonly logger = new Logger(AutoWithdrawSweepService.name);

  constructor(
    private readonly walletsService: WalletsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  @Cron('* * * * *')
  async sweep(): Promise<void> {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes(),
    ).padStart(2, '0')}`;

    const candidates = await this.walletsService.listWithAutoWithdrawDue();
    const due = candidates.filter((wallet) =>
      wallet.autoWithdrawTimes?.includes(currentTime),
    );

    for (const wallet of due) {
      await this.transactionsService.sweepAutoWithdraw(wallet.id);
      this.logger.log(`Auto-swept wallet ${wallet.id} at ${currentTime}`);
    }
  }
}
