import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletType } from '../wallet-types/entities/wallet-type.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'packeta',
  password: process.env.DB_PASSWORD ?? 'packeta',
  database: process.env.DB_DATABASE ?? 'packeta',
  entities: [User, Wallet, WalletType, Transaction, IdempotencyKey],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
