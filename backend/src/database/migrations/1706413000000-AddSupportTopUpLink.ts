import { MigrationInterface, QueryRunner } from 'typeorm';

// Links a real-money DEPOSIT-style transaction (a ZarinPal top-up into a
// customer's auto-provisioned SUPPORT wallet) back to the PENDING PURCHASE
// it exists to fund the shortfall of — see
// TransactionsService.initiateSupportTopUp / verifyPurchase.
export class AddSupportTopUpLink1706413000000 implements MigrationInterface {
  name = 'AddSupportTopUpLink1706413000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transactions" ADD COLUMN "completesPurchaseId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ADD CONSTRAINT "FK_transactions_completesPurchaseId"
        FOREIGN KEY ("completesPurchaseId") REFERENCES "transactions"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_completesPurchaseId" ON "transactions" ("completesPurchaseId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_transactions_completesPurchaseId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_transactions_completesPurchaseId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "completesPurchaseId"`,
    );
  }
}
