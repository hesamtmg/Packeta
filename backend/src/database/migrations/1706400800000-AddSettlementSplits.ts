import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSettlementSplits1706400800000 implements MigrationInterface {
  name = 'AddSettlementSplits1706400800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "settlement_splits_splittype_enum" AS ENUM('PERCENT', 'FIXED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "settlement_splits" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "walletId" uuid,
        "transactionId" uuid,
        "iban" varchar(34) NOT NULL,
        "label" varchar(100),
        "splitType" "settlement_splits_splittype_enum" NOT NULL,
        "percentValue" numeric(6,3),
        "fixedAmount" bigint,
        "sortOrder" int NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_settlement_splits" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_settlement_splits_owner" CHECK (
          ("walletId" IS NOT NULL AND "transactionId" IS NULL) OR
          ("walletId" IS NULL AND "transactionId" IS NOT NULL)
        ),
        CONSTRAINT "FK_settlement_splits_wallet" FOREIGN KEY ("walletId") REFERENCES "wallets"("id"),
        CONSTRAINT "FK_settlement_splits_transaction" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_settlement_splits_walletId" ON "settlement_splits" ("walletId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_settlement_splits_transactionId" ON "settlement_splits" ("transactionId")`,
    );

    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN "settledAt" timestamptz, ADD COLUMN "destinationIban" varchar(34)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "settledAt", DROP COLUMN "destinationIban"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_settlement_splits_transactionId"`);
    await queryRunner.query(`DROP INDEX "IDX_settlement_splits_walletId"`);
    await queryRunner.query(`DROP TABLE "settlement_splits"`);
    await queryRunner.query(`DROP TYPE "settlement_splits_splittype_enum"`);
  }
}
