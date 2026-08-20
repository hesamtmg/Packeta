import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionsService } from '../transactions/transactions.service';
import { effectiveRailScheduleTimes } from '../rail-settlements/rail-schedule';
import { LoggingService } from '../logging/logging.service';
import { currentTehranTime } from '../common/tehran-time';

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
    private readonly loggingService: LoggingService,
  ) {}

  @Cron('* * * * *')
  async sweep(): Promise<void> {
    console.log('SettlementRailSweepService');
    const currentTime = currentTehranTime();

    const candidates = await this.walletsService.listWithRailSettlementDue();
    const due = candidates.filter((wallet) => {
      const times = effectiveRailScheduleTimes(
        wallet.railType!,
        wallet.railScheduleTimes,
      );
      return times?.includes(currentTime) ?? false;
    });

    for (const wallet of due) {
      const created = await this.transactionsService.sweepAutoWithdraw(
        wallet.id,
      );
      this.logger.log(
        `Rail-settled wallet ${wallet.id} via ${wallet.railType} at ${currentTime}`,
      );
      await this.loggingService.log({
        category: 'SCHEDULER',
        action: 'rail_settlement_sweep',
        success: true,
        metadata: {
          walletId: wallet.id,
          railType: wallet.railType,
          currentTime,
          transactions: created.map((tx) => ({
            id: tx.id,
            amount: tx.amount,
            destinationIban: tx.destinationIban,
          })),
        },
      });
    }
  }
}
