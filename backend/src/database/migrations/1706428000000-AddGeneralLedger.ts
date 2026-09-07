import { MigrationInterface, QueryRunner } from 'typeorm';

// Double-entry GL postings alongside the existing wallet-balance/Transaction
// ledger — see LedgerService and GlAccountCode for what each account means
// and which transactions post to it. gl_accounts is seeded data (one row per
// account code per currency, same pattern as wallet_types/currencies) rather
// than something created through the API.
export class AddGeneralLedger1706428000000 implements MigrationInterface {
  name = 'AddGeneralLedger1706428000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "gl_accounts_code_enum" AS ENUM('BANK_CASH', 'CUSTOMER_WALLETS', 'CREDIT_RECEIVABLE', 'SETTLEMENT_CLEARING', 'FEE_REVENUE', 'LEDGER_ADJUSTMENTS')`,
    );
    await queryRunner.query(
      `CREATE TYPE "gl_accounts_type_enum" AS ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE')`,
    );
    await queryRunner.query(`
      CREATE TABLE "gl_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" "gl_accounts_code_enum" NOT NULL,
        "name" varchar(100) NOT NULL,
        "type" "gl_accounts_type_enum" NOT NULL,
        "currencyId" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gl_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gl_accounts_currency" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_gl_accounts_code_currencyId" ON "gl_accounts" ("code", "currencyId")`,
    );

    await queryRunner.query(
      `CREATE TYPE "gl_postings_direction_enum" AS ENUM('DEBIT', 'CREDIT')`,
    );
    await queryRunner.query(`
      CREATE TABLE "gl_journal_entries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "transactionId" uuid NOT NULL,
        "description" varchar(255) NOT NULL,
        "reversalOfId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gl_journal_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_gl_journal_entries_transaction" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id"),
        CONSTRAINT "FK_gl_journal_entries_reversalOf" FOREIGN KEY ("reversalOfId") REFERENCES "gl_journal_entries"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_gl_journal_entries_transactionId" ON "gl_journal_entries" ("transactionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gl_journal_entries_reversalOfId" ON "gl_journal_entries" ("reversalOfId")`,
    );

    await queryRunner.query(`
      CREATE TABLE "gl_postings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "journalEntryId" uuid NOT NULL,
        "accountId" uuid NOT NULL,
        "direction" "gl_postings_direction_enum" NOT NULL,
        "amount" bigint NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gl_postings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_gl_postings_amount_positive" CHECK ("amount" > 0),
        CONSTRAINT "FK_gl_postings_journalEntry" FOREIGN KEY ("journalEntryId") REFERENCES "gl_journal_entries"("id"),
        CONSTRAINT "FK_gl_postings_account" FOREIGN KEY ("accountId") REFERENCES "gl_accounts"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_gl_postings_journalEntryId" ON "gl_postings" ("journalEntryId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_gl_postings_accountId" ON "gl_postings" ("accountId")`,
    );

    // Seed every account code for every currency that already exists (USD,
    // IRR) — a currency added later needs its own seeding, same as how a
    // new currency today doesn't retroactively get wallet_types rows either.
    await queryRunner.query(`
      INSERT INTO "gl_accounts" ("code", "name", "type", "currencyId")
      SELECT v.code::"gl_accounts_code_enum", v.name || ' (' || c."code" || ')', v.type::"gl_accounts_type_enum", c."id"
      FROM (VALUES
        ('BANK_CASH', 'Bank Cash', 'ASSET'),
        ('CUSTOMER_WALLETS', 'Customer Wallets', 'LIABILITY'),
        ('CREDIT_RECEIVABLE', 'Credit Receivable', 'ASSET'),
        ('SETTLEMENT_CLEARING', 'Settlement Clearing', 'LIABILITY'),
        ('FEE_REVENUE', 'Fee Revenue', 'REVENUE'),
        ('LEDGER_ADJUSTMENTS', 'Ledger Adjustments', 'EQUITY')
      ) AS v(code, name, type)
      CROSS JOIN "currencies" c
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_gl_postings_accountId"`);
    await queryRunner.query(`DROP INDEX "IDX_gl_postings_journalEntryId"`);
    await queryRunner.query(`DROP TABLE "gl_postings"`);
    await queryRunner.query(`DROP TYPE "gl_postings_direction_enum"`);

    await queryRunner.query(`DROP INDEX "IDX_gl_journal_entries_reversalOfId"`);
    await queryRunner.query(`DROP INDEX "IDX_gl_journal_entries_transactionId"`);
    await queryRunner.query(`DROP TABLE "gl_journal_entries"`);

    await queryRunner.query(`DROP INDEX "IDX_gl_accounts_code_currencyId"`);
    await queryRunner.query(`DROP TABLE "gl_accounts"`);
    await queryRunner.query(`DROP TYPE "gl_accounts_type_enum"`);
    await queryRunner.query(`DROP TYPE "gl_accounts_code_enum"`);
  }
}
