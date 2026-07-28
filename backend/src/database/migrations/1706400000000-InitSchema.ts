import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1706400000000 implements MigrationInterface {
  name = 'InitSchema1706400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "passwordHash" varchar(255) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_email" ON "users" ("email")`,
    );

    await queryRunner.query(`
      CREATE TABLE "wallets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "balance" bigint NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallets" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_wallets_balance_nonnegative" CHECK ("balance" >= 0),
        CONSTRAINT "FK_wallets_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_wallets_userId" ON "wallets" ("userId")`,
    );

    await queryRunner.query(
      `CREATE TYPE "transactions_type_enum" AS ENUM('DEPOSIT', 'WITHDRAW', 'TRANSFER')`,
    );
    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "type" "transactions_type_enum" NOT NULL,
        "fromWalletId" uuid,
        "toWalletId" uuid,
        "amount" bigint NOT NULL,
        "idempotencyKey" varchar(255) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_transactions_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "FK_transactions_fromWallet" FOREIGN KEY ("fromWalletId") REFERENCES "wallets"("id"),
        CONSTRAINT "FK_transactions_toWallet" FOREIGN KEY ("toWalletId") REFERENCES "wallets"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_fromWalletId" ON "transactions" ("fromWalletId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_toWalletId" ON "transactions" ("toWalletId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_transactions_idempotencyKey" ON "transactions" ("idempotencyKey")`,
    );

    await queryRunner.query(
      `CREATE TYPE "idempotency_keys_status_enum" AS ENUM('IN_PROGRESS', 'COMPLETED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "idempotency_keys" (
        "key" varchar(255) NOT NULL,
        "userId" uuid NOT NULL,
        "endpoint" varchar(64) NOT NULL,
        "requestHash" varchar(64) NOT NULL,
        "status" "idempotency_keys_status_enum" NOT NULL DEFAULT 'IN_PROGRESS',
        "responseBody" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
    await queryRunner.query(`DROP TYPE "idempotency_keys_status_enum"`);
    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(`DROP TYPE "transactions_type_enum"`);
    await queryRunner.query(`DROP TABLE "wallets"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
