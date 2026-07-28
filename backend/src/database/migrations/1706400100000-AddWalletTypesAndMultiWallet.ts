import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalletTypesAndMultiWallet1706400100000 implements MigrationInterface {
  name = 'AddWalletTypesAndMultiWallet1706400100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "wallet_types" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" varchar(32) NOT NULL,
        "name" varchar(100) NOT NULL,
        "allowNegativeBalance" boolean NOT NULL DEFAULT false,
        "creditLimit" bigint,
        "allowWithdraw" boolean NOT NULL DEFAULT true,
        "allowP2pOut" boolean NOT NULL DEFAULT false,
        "allowP2pIn" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallet_types" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_wallet_types_code" ON "wallet_types" ("code")`,
    );

    await queryRunner.query(`
      INSERT INTO "wallet_types"
        ("code", "name", "allowNegativeBalance", "creditLimit", "allowWithdraw", "allowP2pOut", "allowP2pIn")
      VALUES
        ('BUY', 'Buy', false, NULL, true, true, true),
        ('SELL', 'Sell', false, NULL, true, false, false),
        ('CREDIT', 'Credit', true, 100000, true, false, false),
        ('GIFT', 'Gift', false, NULL, false, false, false)
    `);

    // --- wallets: allow multiple per user, tag each with a wallet type ---
    await queryRunner.query(`DROP INDEX "IDX_wallets_userId"`);
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP CONSTRAINT "CHK_wallets_balance_nonnegative"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD COLUMN "walletTypeId" uuid`,
    );
    await queryRunner.query(`
      UPDATE "wallets" SET "walletTypeId" = (SELECT "id" FROM "wallet_types" WHERE "code" = 'BUY')
      WHERE "walletTypeId" IS NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "wallets" ALTER COLUMN "walletTypeId" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD CONSTRAINT "FK_wallets_walletType"
      FOREIGN KEY ("walletTypeId") REFERENCES "wallet_types"("id")
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_wallets_walletTypeId" ON "wallets" ("walletTypeId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wallets_userId" ON "wallets" ("userId")`,
    );

    // Balance floor now depends on the wallet's type (0, or -creditLimit for
    // types that allow going negative), which a plain CHECK constraint can't
    // express since it can't join another table. Enforce it with a trigger.
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER "trg_wallets_balance_floor" ON "wallets"`,
    );
    await queryRunner.query(`DROP FUNCTION enforce_wallet_balance_floor()`);

    await queryRunner.query(`DROP INDEX "IDX_wallets_userId"`);
    await queryRunner.query(`DROP INDEX "IDX_wallets_walletTypeId"`);
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP CONSTRAINT "FK_wallets_walletType"`,
    );
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "walletTypeId"`);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD CONSTRAINT "CHK_wallets_balance_nonnegative" CHECK ("balance" >= 0)
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_wallets_userId" ON "wallets" ("userId")`,
    );

    await queryRunner.query(`DROP TABLE "wallet_types"`);
  }
}
