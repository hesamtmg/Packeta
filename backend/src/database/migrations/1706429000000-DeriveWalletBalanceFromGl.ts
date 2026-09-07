import { MigrationInterface, QueryRunner } from 'typeorm';

// wallets.balance stops being an independently-updated cached column —
// every wallet's balance is now derived by summing its own gl_postings (see
// LedgerService.getWalletBalance): CREDIT postings increase it, DEBIT
// postings decrease it, uniformly for every wallet type. That requires
// gl_postings to know which wallet a posting belongs to (walletId — null
// for postings against a non-wallet account like BANK_CASH).
//
// A repository-backed CREDIT wallet now posts to its own account too (a
// mirror of its real balance movement, tagged with its own walletId),
// alongside the REPOSITORY's own existing real-money posting — see
// LedgerService.postRepositoryAllocationMirror. The new REPOSITORY_ALLOCATIONS
// account is that mirror's offsetting leg, so the trial balance still nets
// to zero despite the same real money now being represented on two wallets'
// worth of postings.
//
// The DB-level floor trigger (trg_wallets_balance_floor) enforced the floor
// by checking NEW."balance" on every UPDATE — with no balance column left to
// check, that enforcement moves into application code (TransactionsService),
// computing the would-be new balance from the GL before deciding whether to
// post.
//
// Every gl_postings row written before this migration has no walletId at
// all (the column didn't exist yet), so it can never contribute to
// getWalletBalance's sum — same situation the AddGeneralLedger migration
// left for the original wallet-tagging-free postings, which is why that one
// shipped alongside a standalone `npm run backfill-gl` script rather than
// trying to backfill in-migration. Rather than leave those old, permanently
// walletId-less rows sitting alongside new ones (which would silently
// undercount every wallet's derived balance by its pre-migration history),
// this migration clears gl_journal_entries/gl_postings outright — they are
// pure derived data, fully reconstructible from the Transaction table,
// never referenced by foreign key from outside the GL module — and OPERATORS
// MUST RUN `npm run backfill-gl` IMMEDIATELY AFTER THIS MIGRATION to
// reconstruct them, this time with walletId tags and repository-allocation
// mirror postings included. Until that backfill runs, every wallet's
// derived balance reads as 0.
export class DeriveWalletBalanceFromGl1706429000000
  implements MigrationInterface
{
  name = 'DeriveWalletBalanceFromGl1706429000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "gl_postings" ADD COLUMN "walletId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "gl_postings"
        ADD CONSTRAINT "FK_gl_postings_wallet" FOREIGN KEY ("walletId") REFERENCES "wallets"("id")
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_gl_postings_walletId" ON "gl_postings" ("walletId")`,
    );

    // Rebuild the enum (rather than a bare ADD VALUE) so the new value can
    // be used for the seed INSERT below in the same migration — Postgres
    // won't let a freshly-added enum value be used in the same transaction
    // that added it.
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

    await queryRunner.query(`
      INSERT INTO "gl_accounts" ("code", "name", "type", "currencyId")
      SELECT 'REPOSITORY_ALLOCATIONS'::"gl_accounts_code_enum", 'Repository Allocations (' || c."code" || ')', 'EQUITY'::"gl_accounts_type_enum", c."id"
      FROM "currencies" c
    `);

    // See the class comment: every existing posting predates walletId and
    // can never be retagged automatically, so start the wallet-tagged era
    // clean and let `npm run backfill-gl` rebuild history properly.
    await queryRunner.query(
      `TRUNCATE TABLE "gl_postings", "gl_journal_entries"`,
    );

    await queryRunner.query(
      `DROP TRIGGER "trg_wallets_balance_floor" ON "wallets"`,
    );
    await queryRunner.query(`DROP FUNCTION enforce_wallet_balance_floor()`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "balance"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restored balances start at 0, not reconstructed from the GL — a
    // rollback needs a follow-up backfill (sum each wallet's postings) if
    // the cached column must reflect real history again.
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD COLUMN "balance" bigint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_wallet_balance_floor() RETURNS TRIGGER AS $$
      DECLARE
        allow_negative boolean;
        credit_limit bigint;
        floor_value bigint;
      BEGIN
        SELECT "allowNegativeBalance", "creditLimit" INTO allow_negative, credit_limit
        FROM "wallet_types" WHERE "id" = NEW."walletTypeId";

        IF allow_negative THEN
          floor_value := -COALESCE(credit_limit, 0);
        ELSE
          floor_value := 0;
        END IF;

        IF NEW."balance" < floor_value THEN
          RAISE EXCEPTION 'wallet balance % is below allowed floor % for wallet %',
            NEW."balance", floor_value, NEW."id";
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_wallets_balance_floor"
      BEFORE INSERT OR UPDATE OF "balance", "walletTypeId" ON "wallets"
      FOR EACH ROW EXECUTE FUNCTION enforce_wallet_balance_floor()
    `);

    await queryRunner.query(`
      DELETE FROM "gl_accounts" WHERE "code" = 'REPOSITORY_ALLOCATIONS'
    `);
    await queryRunner.query(
      `ALTER TYPE "gl_accounts_code_enum" RENAME TO "gl_accounts_code_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "gl_accounts_code_enum" AS ENUM('BANK_CASH', 'CUSTOMER_WALLETS', 'CREDIT_RECEIVABLE', 'SETTLEMENT_CLEARING', 'FEE_REVENUE', 'LEDGER_ADJUSTMENTS')`,
    );
    await queryRunner.query(`
      ALTER TABLE "gl_accounts" ALTER COLUMN "code" TYPE "gl_accounts_code_enum"
      USING "code"::text::"gl_accounts_code_enum"
    `);
    await queryRunner.query(`DROP TYPE "gl_accounts_code_enum_old"`);

    await queryRunner.query(`DROP INDEX "IDX_gl_postings_walletId"`);
    await queryRunner.query(
      `ALTER TABLE "gl_postings" DROP CONSTRAINT "FK_gl_postings_wallet"`,
    );
    await queryRunner.query(`ALTER TABLE "gl_postings" DROP COLUMN "walletId"`);
  }
}
