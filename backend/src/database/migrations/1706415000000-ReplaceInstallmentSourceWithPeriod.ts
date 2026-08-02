import { MigrationInterface, QueryRunner } from 'typeorm';

// Supersedes the previous AddVirtualTransactionType migration's
// Installment.sourceTransactionId: a batch of installments no longer traces
// back to a single VIRTUAL grant transaction — InstallmentsService
// .generateDue now sums *every* VIRTUAL transaction touching the credit
// wallet itself over a one-month billing window and splits that total, so
// each batch instead records the window it was summed over
// (periodStart/periodEnd — see Installment's doc comment).
export class ReplaceInstallmentSourceWithPeriod1706415000000 implements MigrationInterface {
  name = 'ReplaceInstallmentSourceWithPeriod1706415000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "installments" ADD COLUMN "periodStart" date
    `);
    await queryRunner.query(`
      ALTER TABLE "installments" ADD COLUMN "periodEnd" date
    `);
    // Best-effort backfill for rows generated under the old model: treat
    // dueDate as the period's end and one calendar month before it as the
    // start, so existing rows still satisfy the new NOT NULL columns.
    await queryRunner.query(`
      UPDATE "installments"
      SET "periodEnd" = "dueDate", "periodStart" = "dueDate" - INTERVAL '1 month'
      WHERE "periodEnd" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "installments" ALTER COLUMN "periodStart" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "installments" ALTER COLUMN "periodEnd" SET NOT NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_installments_periodEnd" ON "installments" ("periodEnd")`,
    );

    await queryRunner.query(
      `DROP INDEX "IDX_installments_sourceTransactionId"`,
    );
    await queryRunner.query(`
      ALTER TABLE "installments" DROP CONSTRAINT "FK_installments_sourceTransactionId"
    `);
    await queryRunner.query(`
      ALTER TABLE "installments" DROP COLUMN "sourceTransactionId"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "installments" ADD COLUMN "sourceTransactionId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "installments"
        ADD CONSTRAINT "FK_installments_sourceTransactionId"
        FOREIGN KEY ("sourceTransactionId") REFERENCES "transactions"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_installments_sourceTransactionId" ON "installments" ("sourceTransactionId")`,
    );

    await queryRunner.query(`DROP INDEX "IDX_installments_periodEnd"`);
    await queryRunner.query(
      `ALTER TABLE "installments" DROP COLUMN "periodEnd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "installments" DROP COLUMN "periodStart"`,
    );
  }
}
