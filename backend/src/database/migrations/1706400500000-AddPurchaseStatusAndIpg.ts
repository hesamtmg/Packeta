import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPurchaseStatusAndIpg1706400500000 implements MigrationInterface {
  name = 'AddPurchaseStatusAndIpg1706400500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Every existing row (DEPOSIT/WITHDRAW/TRANSFER/ADJUSTMENT) was already
    // completed the instant it was inserted, so COMPLETED is the correct
    // backfilled default. Only PURCHASE rows going forward will ever be
    // PENDING or REVERSED.
    await queryRunner.query(`
      CREATE TYPE "transactions_status_enum" AS ENUM('PENDING', 'COMPLETED', 'REVERSED')
    `);
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ADD COLUMN "status" "transactions_status_enum" NOT NULL DEFAULT 'COMPLETED',
        ADD COLUMN "expiresAt" timestamptz,
        ADD COLUMN "relatedTransactionId" uuid,
        ADD COLUMN "ipgAuthority" varchar(100),
        ADD COLUMN "ipgPaymentUrl" varchar(500)
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_relatedTransactionId" ON "transactions" ("relatedTransactionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_ipgAuthority" ON "transactions" ("ipgAuthority")`,
    );

    // Merchant wallets only: how long a PURCHASE stays PENDING awaiting the
    // IPG callback + verify before the timeout sweep marks it REVERSED. No
    // balance is ever held for this — the customer isn't debited until
    // /verify succeeds — so there's nothing to money-reverse, just status.
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD COLUMN "purchaseTimeoutSeconds" int`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN "purchaseTimeoutSeconds"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_transactions_ipgAuthority"`);
    await queryRunner.query(
      `DROP INDEX "IDX_transactions_relatedTransactionId"`,
    );
    await queryRunner.query(`
      ALTER TABLE "transactions"
        DROP COLUMN "status",
        DROP COLUMN "expiresAt",
        DROP COLUMN "relatedTransactionId",
        DROP COLUMN "ipgAuthority",
        DROP COLUMN "ipgPaymentUrl"
    `);
    await queryRunner.query(`DROP TYPE "transactions_status_enum"`);
  }
}
