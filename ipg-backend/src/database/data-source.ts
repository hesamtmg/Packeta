import 'dotenv/config';
import { DataSource } from 'typeorm';
import { PaymentIntent } from '../payments/entities/payment-intent.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5433', 10),
  username: process.env.DB_USERNAME ?? 'ipg',
  password: process.env.DB_PASSWORD ?? 'ipg',
  database: process.env.DB_DATABASE ?? 'packeta_ipg',
  entities: [PaymentIntent],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
});
