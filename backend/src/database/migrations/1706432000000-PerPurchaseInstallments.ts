import { MigrationInterface, QueryRunner } from 'typeorm';

// Installments are now generated per credit-funded purchase, the moment it
// settles (see InstallmentsService.createForPurchase), instead of once a
// month from a billing period's summed VIRTUAL activity:
//   - purchaseTransactionId links a plan back to the purchase it repays,
//   - dueCheckedAt records the daily sweep's check on the due date,
//   - CANCELED covers a plan whose purchase was refunded before being paid.
export class PerPurchaseInstallments1706432000000 implements MigrationInterface {
  name = 'PerPurchaseInstallments1706432000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "installments_status_enum" ADD VALUE IF NOT EXISTS 'CANCELED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "installments" ADD COLUMN "purchaseTransactionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "installments" ADD COLUMN "dueCheckedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_installments_purchaseTransactionId" ON "installments" ("purchaseTransactionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_installments_purchaseTransactionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "installments" DROP COLUMN "dueCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "installments" DROP COLUMN "purchaseTransactionId"`,
    );
    // Postgres can't drop a single enum value; CANCELED rows are mapped
    // back to PENDING and the value is left in place, harmlessly unused.
    await queryRunner.query(
      `UPDATE "installments" SET "status" = 'PENDING' WHERE "status" = 'CANCELED'`,
    );
  }
}
