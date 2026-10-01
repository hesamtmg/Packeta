import { MigrationInterface, QueryRunner } from 'typeorm';

// Repository wallets (the real money a repository owner charges in) now post
// to their own liability account, REPOSITORY_FUNDS, instead of folding into
// CUSTOMER_WALLETS — same shape as CUSTOMER_WALLETS, just broken out so it
// shows up on its own in the trial balance. MERCHANT_REPOSITORY wallets
// (which receive installment fee/penalty/unblock-fee slices) post to the
// existing FEE_REVENUE account, which needs no schema change.
//
// Every gl_postings row already written for a repository wallet still sits on
// CUSTOMER_WALLETS, so OPERATORS MUST RUN `npm run backfill-gl` AFTER THIS
// MIGRATION to rebuild the GL under the new mapping (it is pure derived data,
// reconstructible from the Transaction table). Until then, the trial balance
// shows repository money under the old account.
export class AddRepositoryFundsGlAccount1706431000000
  implements MigrationInterface
{
  name = 'AddRepositoryFundsGlAccount1706431000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rebuild the enum (rather than a bare ADD VALUE) so the new value can
    // be used for the seed INSERT below in the same migration — Postgres
    // won't let a freshly-added enum value be used in the same transaction
    // that added it.
    await queryRunner.query(
      `ALTER TYPE "gl_accounts_code_enum" RENAME TO "gl_accounts_code_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "gl_accounts_code_enum" AS ENUM('BANK_CASH', 'CUSTOMER_WALLETS', 'CREDIT_RECEIVABLE', 'SETTLEMENT_CLEARING', 'FEE_REVENUE', 'LEDGER_ADJUSTMENTS', 'REPOSITORY_ALLOCATIONS', 'REPOSITORY_FUNDS')`,
    );
    await queryRunner.query(`
      ALTER TABLE "gl_accounts" ALTER COLUMN "code" TYPE "gl_accounts_code_enum"
      USING "code"::text::"gl_accounts_code_enum"
    `);
    await queryRunner.query(`DROP TYPE "gl_accounts_code_enum_old"`);

    await queryRunner.query(`
      INSERT INTO "gl_accounts" ("code", "name", "type", "currencyId")
      SELECT 'REPOSITORY_FUNDS'::"gl_accounts_code_enum", 'Repository Funds (' || c."code" || ')', 'LIABILITY'::"gl_accounts_type_enum", c."id"
      FROM "currencies" c
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Move any postings back to CUSTOMER_WALLETS (same currency) so the
    // REPOSITORY_FUNDS rows can be deleted without orphaning them.
    await queryRunner.query(`
      UPDATE "gl_postings" p
      SET "accountId" = cw."id"
      FROM "gl_accounts" rf
      JOIN "gl_accounts" cw
        ON cw."currencyId" = rf."currencyId" AND cw."code" = 'CUSTOMER_WALLETS'
      WHERE p."accountId" = rf."id" AND rf."code" = 'REPOSITORY_FUNDS'
    `);
    await queryRunner.query(
      `DELETE FROM "gl_accounts" WHERE "code" = 'REPOSITORY_FUNDS'`,
    );
    await queryRunner.query(
      `ALTER TYPE "gl_accounts_code_enum" RENAME TO "gl_accounts_code_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "gl_accounts_code_enum" AS ENUM('BANK_CASH', 'CUSTOMER_WALLETS', 'CREDIT_RECEIVABLE', 'SETTLEMENT_CLEARING', 'FEE_REVENUE', 'LEDGER_ADJUSTMENTS', 'REPOSITORY_ALLOCATIONS')`,
    );
    await queryRunner.query(`
      ALTER TABLE "gl_accounts" ALTER COLUMN "code" TYPE "gl_accounts_code_enum"
      USING "code"::text::"gl_accounts_code_enum"
    `);
    await queryRunner.query(`DROP TYPE "gl_accounts_code_enum_old"`);
  }
}
