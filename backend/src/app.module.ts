import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import configuration from './config/configuration';
import { User } from './users/entities/user.entity';
import { Wallet } from './wallets/entities/wallet.entity';
import { WalletType } from './wallet-types/entities/wallet-type.entity';
import { Currency } from './currencies/entities/currency.entity';
import { Transaction } from './transactions/entities/transaction.entity';
import { IdempotencyKey } from './idempotency/entities/idempotency-key.entity';
import { SettlementSplit } from './settlement/entities/settlement-split.entity';
import { Installment } from './installments/entities/installment.entity';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletsModule } from './wallets/wallets.module';
import { WalletTypesModule } from './wallet-types/wallet-types.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { TransactionsModule } from './transactions/transactions.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { LoggingModule } from './logging/logging.module';
import { AdminModule } from './admin/admin.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { PurchaseGatewayModule } from './purchase-gateway/purchase-gateway.module';
import { SettlementModule } from './settlement/settlement.module';

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
        entities: [
          User,
          Wallet,
          WalletType,
          Currency,
          Transaction,
          IdempotencyKey,
          SettlementSplit,
          Installment,
        ],
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
    WalletTypesModule,
    CurrenciesModule,
    TransactionsModule,
    IdempotencyModule,
    LoggingModule,
    AdminModule,
    SchedulerModule,
    PurchaseGatewayModule,
    SettlementModule,
  ],
})
export class AppModule {}
