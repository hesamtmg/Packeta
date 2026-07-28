import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import configuration from './config/configuration';
import { User } from './users/entities/user.entity';
import { Wallet } from './wallets/entities/wallet.entity';
import { Transaction } from './transactions/entities/transaction.entity';
import { IdempotencyKey } from './idempotency/entities/idempotency-key.entity';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { TransactionsModule } from './transactions/transactions.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { LoggingModule } from './logging/logging.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get('database.port'),
        username: config.get('database.username'),
        password: config.get('database.password'),
        database: config.get('database.name'),
        entities: [User, Wallet, Transaction, IdempotencyKey],
        synchronize: false,
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get('mongo.uri'),
      }),
    }),
    AuthModule,
    UsersModule,
    WalletsModule,
    TransactionsModule,
    IdempotencyModule,
    LoggingModule,
  ],
})
export class AppModule {}
