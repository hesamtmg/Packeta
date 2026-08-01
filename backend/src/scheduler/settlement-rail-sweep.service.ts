import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionsService } from '../transactions/transactions.service';
import { effectiveRailScheduleTimes } from '../rail-settlements/rail-schedule';

// Merchant wallets configured with a withdrawal-schedule rail (Pol Pay /
// Paya / Satna / bank transfer — see Wallet.railType) get swept on that
// rail's own "HH:MM" schedule instead of the generic, wallet-type-wide
// autoWithdrawTimes (see AutoWithdrawSweepService, which explicitly skips
// these wallets). Runs once a minute and only acts on wallets whose rail's
// effective schedule (custom override, else the rail's built-in default)
// matches the current minute.
@Injectable()
export class SettlementRailSweepService {
  private readonly logger = new Logger(SettlementRailSweepService.name);

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

    const candidates = await this.walletsService.listWithRailSettlementDue();
    const due = candidates.filter((wallet) => {
      const times = effectiveRailScheduleTimes(
        wallet.railType!,
        wallet.railScheduleTimes,
      );
      return times?.includes(currentTime) ?? false;
    });

    for (const wallet of due) {
      await this.transactionsService.sweepAutoWithdraw(wallet.id);
      this.logger.log(
        `Rail-settled wallet ${wallet.id} via ${wallet.railType} at ${currentTime}`,
      );
    }
  }
}
