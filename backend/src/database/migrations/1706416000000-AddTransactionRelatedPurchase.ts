import { MigrationInterface, QueryRunner } from 'typeorm';

// Lets a VIRTUAL credit-ceiling draw-down (see TransactionsService
// .settleCreditFundedPurchase) point back at the PURCHASE it funded, so
// InstallmentsService can show which merchants a period's installment
// total was actually spent at (see getSpendBreakdown).
export class AddTransactionRelatedPurchase1706416000000 implements MigrationInterface {
  name = 'AddTransactionRelatedPurchase1706416000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transactions" ADD COLUMN "relatedPurchaseId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ADD CONSTRAINT "FK_transactions_relatedPurchaseId"
        FOREIGN KEY ("relatedPurchaseId") REFERENCES "transactions"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_relatedPurchaseId" ON "transactions" ("relatedPurchaseId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_transactions_relatedPurchaseId"`);
    await queryRunner.query(`
      ALTER TABLE "transactions" DROP CONSTRAINT "FK_transactions_relatedPurchaseId"
    `);
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "relatedPurchaseId"`,
    );
  }
}
