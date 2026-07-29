import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantPurchaseAutoWithdraw1706400400000 implements MigrationInterface {
  name = 'AddMerchantPurchaseAutoWithdraw1706400400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        ADD COLUMN "supportsAutoWithdraw" boolean NOT NULL DEFAULT false,
        ADD COLUMN "allowPurchaseOut" boolean NOT NULL DEFAULT false,
        ADD COLUMN "allowPurchaseIn" boolean NOT NULL DEFAULT false,
        ADD COLUMN "isStarterType" boolean NOT NULL DEFAULT false
    `);

    // Only the four original types are part of every new signup's default
    // starter set. Without this, any custom type created in the default
    // currency (e.g. an admin-created "Rewards" type, or the new Merchant
    // type below) would silently start being granted to every new signup,
    // since createDefaultWalletsForUser previously only filtered by currency.
    await queryRunner.query(`
      UPDATE "wallet_types" SET "isStarterType" = true
      WHERE "code" IN ('BUY', 'SELL', 'CREDIT', 'GIFT')
    `);

    // Customers can pay merchants immediately once this ships.
    await queryRunner.query(`
      UPDATE "wallet_types" SET "allowPurchaseOut" = true WHERE "code" = 'BUY'
    `);

    // Purchases get their own ledger type, distinct from an ordinary P2P
    // transfer, even though the underlying mechanics mirror it.
    await queryRunner.query(
      `ALTER TYPE "transactions_type_enum" ADD VALUE 'PURCHASE'`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallets" ADD COLUMN "autoWithdrawTimes" varchar(5)[]`,
    );

    // Merchant wallets: not part of the default starter set (opt-in, created
    // via POST /wallets like any other type), can't send/receive P2P
    // transfers or purchases outward, but can receive purchases and support
    // the per-wallet auto-withdraw schedule.
    await queryRunner.query(`
      INSERT INTO "wallet_types"
        ("code", "name", "currencyId", "allowNegativeBalance", "creditLimit", "allowWithdraw", "allowP2pOut", "allowP2pIn", "supportsAutoWithdraw", "allowPurchaseOut", "allowPurchaseIn", "isStarterType")
      SELECT 'MERCHANT', 'Merchant', "id", false, NULL, true, false, false, true, false, true, false
      FROM "currencies" WHERE "code" IN ('USD', 'IRR')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "wallet_types" WHERE "code" = 'MERCHANT'`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN "autoWithdrawTimes"`,
    );

    // Postgres can't drop a single enum value, so rebuild the type without it.
    await queryRunner.query(
      `ALTER TYPE "transactions_type_enum" RENAME TO "transactions_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "transactions_type_enum" AS ENUM('DEPOSIT', 'WITHDRAW', 'TRANSFER', 'ADJUSTMENT')`,
    );
    await queryRunner.query(`
      ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "transactions_type_enum"
      USING "type"::text::"transactions_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "transactions_type_enum_old"`);

    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        DROP COLUMN "supportsAutoWithdraw",
        DROP COLUMN "allowPurchaseOut",
        DROP COLUMN "allowPurchaseIn",
        DROP COLUMN "isStarterType"
    `);
  }
}
