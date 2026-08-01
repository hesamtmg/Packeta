import { MigrationInterface, QueryRunner } from 'typeorm';

// Withdrawal-schedule rails: a merchant wallet's auto-withdraw sweep can now
// pay out over one of Iran's interbank rails (Pol Pay / Paya / Satna / a
// direct bank transfer), each with its own "HH:MM" processing-window
// schedule (see rail-schedule.ts) instead of the generic, wallet-type-wide
// autoWithdrawTimes. Every payout the rail-aware sweep produces gets a
// rail_settlements row alongside its WITHDRAW Transaction — see
// TransactionsService.sweepAutoWithdraw and RailSettlementsService.
export class AddSettlementRails1706409000000 implements MigrationInterface {
  name = 'AddSettlementRails1706409000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "settlement_rail_type_enum" AS ENUM('POL_PAY', 'PAYA', 'SATNA', 'BANK_TRANSFER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "rail_settlements_status_enum" AS ENUM('PENDING', 'COMPLETED', 'FAILED')`,
    );

    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "railType" "settlement_rail_type_enum"
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "railScheduleTimes" character varying(5)[]
    `);

    await queryRunner.query(`
      CREATE TABLE "rail_settlements" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "walletId" uuid NOT NULL,
        "railType" "settlement_rail_type_enum" NOT NULL,
        "amount" bigint NOT NULL,
        "destinationIban" character varying(34),
        "label" character varying(100),
        "status" "rail_settlements_status_enum" NOT NULL DEFAULT 'COMPLETED',
        "scheduledFor" timestamptz NOT NULL,
        "processedAt" timestamptz,
        "transactionId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_rail_settlements_wallet" FOREIGN KEY ("walletId") REFERENCES "wallets"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_rail_settlements_walletId" ON "rail_settlements" ("walletId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_rail_settlements_transactionId" ON "rail_settlements" ("transactionId")`,
    );

    await queryRunner.query(`
      ALTER TABLE "transactions" ADD COLUMN "railSettlementId" uuid
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_railSettlementId" ON "transactions" ("railSettlementId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "rail_settlements"
        ADD CONSTRAINT "FK_rail_settlements_transaction" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id")
    `);
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ADD CONSTRAINT "FK_transactions_railSettlementId" FOREIGN KEY ("railSettlementId") REFERENCES "rail_settlements"("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_transactions_railSettlementId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rail_settlements" DROP CONSTRAINT "FK_rail_settlements_transaction"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_transactions_railSettlementId"`);
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "railSettlementId"`,
    );

    await queryRunner.query(`DROP INDEX "IDX_rail_settlements_transactionId"`);
    await queryRunner.query(`DROP INDEX "IDX_rail_settlements_walletId"`);
    await queryRunner.query(`DROP TABLE "rail_settlements"`);

    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN "railScheduleTimes"`,
    );
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "railType"`);

    await queryRunner.query(`DROP TYPE "rail_settlements_status_enum"`);
    await queryRunner.query(`DROP TYPE "settlement_rail_type_enum"`);
  }
}
