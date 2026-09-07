import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletType } from '../wallet-types/entities/wallet-type.entity';
import { Currency } from '../currencies/entities/currency.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity';
import { PanelRole } from '../panel-roles/entities/panel-role.entity';
import { RailSettlement } from '../rail-settlements/entities/rail-settlement.entity';
import { GlAccount } from '../gl/entities/gl-account.entity';
import { GlJournalEntry } from '../gl/entities/gl-journal-entry.entity';
import { GlPosting } from '../gl/entities/gl-posting.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'packeta',
  password: process.env.DB_PASSWORD ?? 'packeta',
  database: process.env.DB_DATABASE ?? 'packeta',
  entities: [
    User,
    Wallet,
    WalletType,
    Currency,
    Transaction,
    IdempotencyKey,
    PanelRole,
    RailSettlement,
    GlAccount,
    GlJournalEntry,
    GlPosting,
  ],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
