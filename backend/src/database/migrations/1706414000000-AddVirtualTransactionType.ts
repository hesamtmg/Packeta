import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the VIRTUAL transaction type (a virtualAmount-only movement — see
// Transaction.type's doc comment) and links each Installment back to the
// VIRTUAL grant transaction its schedule was split from (see
// InstallmentsService.generateDue), so the plan repays the fixed amount
// actually granted rather than whatever the wallet's virtualAmount happens
// to be — live and fluctuating — at generation time.
export class AddVirtualTransactionType1706414000000 implements MigrationInterface {
  name = 'AddVirtualTransactionType1706414000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "transactions_type_enum" ADD VALUE 'VIRTUAL'`,
    );

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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_installments_sourceTransactionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "installments" DROP CONSTRAINT "FK_installments_sourceTransactionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "installments" DROP COLUMN "sourceTransactionId"`,
    );

    // Postgres can't drop a single enum value directly — rebuild the type
    // without it, same pattern as AddAdminSupport's ADJUSTMENT rollback.
    await queryRunner.query(
      `ALTER TYPE "transactions_type_enum" RENAME TO "transactions_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "transactions_type_enum" AS ENUM('DEPOSIT', 'WITHDRAW', 'TRANSFER', 'ADJUSTMENT', 'PURCHASE')`,
    );
    await queryRunner.query(`
      ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "transactions_type_enum"
      USING "type"::text::"transactions_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "transactions_type_enum_old"`);
  }
}
