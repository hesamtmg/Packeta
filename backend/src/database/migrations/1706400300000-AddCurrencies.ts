import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCurrencies1706400300000 implements MigrationInterface {
  name = 'AddCurrencies1706400300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "currencies_symbolposition_enum" AS ENUM('PREFIX', 'SUFFIX')`,
    );
    await queryRunner.query(`
      CREATE TABLE "currencies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" varchar(8) NOT NULL,
        "name" varchar(100) NOT NULL,
        "symbol" varchar(8) NOT NULL,
        "symbolPosition" "currencies_symbolposition_enum" NOT NULL,
        "decimalPlaces" smallint NOT NULL,
        "isDefault" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_currencies" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_currencies_code" ON "currencies" ("code")`,
    );

    await queryRunner.query(`
      INSERT INTO "currencies"
        ("code", "name", "symbol", "symbolPosition", "decimalPlaces", "isDefault")
      VALUES
        ('USD', 'US Dollar', '$', 'PREFIX', 2, true),
        ('IRR', 'Iranian Rial', 'IRR', 'SUFFIX', 0, false)
    `);

    // --- wallet_types: denominate every existing row in USD, then make
    // (code, currencyId) the uniqueness boundary instead of code alone ---
    await queryRunner.query(`DROP INDEX "IDX_wallet_types_code"`);
    await queryRunner.query(
      `ALTER TABLE "wallet_types" ADD COLUMN "currencyId" uuid`,
    );
    await queryRunner.query(`
      UPDATE "wallet_types" SET "currencyId" = (SELECT "id" FROM "currencies" WHERE "code" = 'USD')
      WHERE "currencyId" IS NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "wallet_types" ALTER COLUMN "currencyId" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "wallet_types" ADD CONSTRAINT "FK_wallet_types_currency"
      FOREIGN KEY ("currencyId") REFERENCES "currencies"("id")
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_types_currencyId" ON "wallet_types" ("currencyId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_wallet_types_code_currencyId" ON "wallet_types" ("code", "currencyId")`,
    );

    // Seed the IRR-denominated counterparts of the four built-in types so
    // Rial is immediately usable, matching what USD already had. Uses an
    // explicit VALUES list (rather than UNION ALL of several SELECTs) since
    // Postgres can fail to resolve a shared type for a NULL/integer column
    // across three or more UNION branches.
    await queryRunner.query(`
      INSERT INTO "wallet_types"
        ("code", "name", "currencyId", "allowNegativeBalance", "creditLimit", "allowWithdraw", "allowP2pOut", "allowP2pIn")
      SELECT v.code, v.name, c."id", v."allowNegativeBalance", v."creditLimit", v."allowWithdraw", v."allowP2pOut", v."allowP2pIn"
      FROM (VALUES
        ('BUY', 'Buy', false, NULL::bigint, true, true, true),
        ('SELL', 'Sell', false, NULL::bigint, true, false, false),
        ('CREDIT', 'Credit', true, 50000000::bigint, true, false, false),
        ('GIFT', 'Gift', false, NULL::bigint, false, false, false)
      ) AS v(code, name, "allowNegativeBalance", "creditLimit", "allowWithdraw", "allowP2pOut", "allowP2pIn")
      CROSS JOIN (SELECT "id" FROM "currencies" WHERE "code" = 'IRR') AS c
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "wallet_types" WHERE "currencyId" = (SELECT "id" FROM "currencies" WHERE "code" = 'IRR')
    `);

    await queryRunner.query(`DROP INDEX "IDX_wallet_types_code_currencyId"`);
    await queryRunner.query(`DROP INDEX "IDX_wallet_types_currencyId"`);
    await queryRunner.query(
      `ALTER TABLE "wallet_types" DROP CONSTRAINT "FK_wallet_types_currency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_types" DROP COLUMN "currencyId"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_wallet_types_code" ON "wallet_types" ("code")`,
    );

    await queryRunner.query(`DROP TABLE "currencies"`);
    await queryRunner.query(`DROP TYPE "currencies_symbolposition_enum"`);
  }
}
