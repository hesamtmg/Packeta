import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionsService } from '../transactions/transactions.service';
import { LoggingService } from '../logging/logging.service';

// Merchant wallet types configure exactly 3 "HH:MM" (server-local) times at
// which every wallet of that type has its full balance auto-swept out via a
// plain WITHDRAW. Runs once a minute and only acts on wallets whose type's
// schedule matches the current minute, so it's a no-op almost every tick.
@Injectable()
export class AutoWithdrawSweepService {
  private readonly logger = new Logger(AutoWithdrawSweepService.name);

  constructor(
    private readonly walletsService: WalletsService,
    private readonly transactionsService: TransactionsService,
    private readonly loggingService: LoggingService,
  ) {}

  @Cron('* * * * *')
  async sweep(): Promise<void> {
          console.log("AutoWithdrawSweepService")
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes(),
    ).padStart(2, '0')}`;

    const candidates = await this.walletsService.listWithAutoWithdrawDue();
    const due = candidates.filter((wallet) =>
      wallet.walletType.autoWithdrawTimes?.includes(currentTime),
    );

    for (const wallet of due) {
      await this.transactionsService.sweepAutoWithdraw(wallet.id);
      this.logger.log(`Auto-swept wallet ${wallet.id} at ${currentTime}`);
      await this.loggingService.log({
        category: 'SCHEDULER',
        action: 'auto_withdraw_sweep',
        success: true,
        metadata: { walletId: wallet.id, currentTime },
      });
    }
  }
}
