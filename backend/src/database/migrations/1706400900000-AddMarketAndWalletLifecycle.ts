import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMarketAndWalletLifecycle1706400900000 implements MigrationInterface {
  name = 'AddMarketAndWalletLifecycle1706400900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Closed marketplace: a wallet may restrict which counterparty emails it
    // can transfer/purchase to or from (see WalletsService.isCounterpartyAllowed).
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "restrictedCounterparties" varchar(255) ARRAY
    `);

    // Soft-close: a wallet with transaction history can't be hard-deleted
    // (transactions reference it by a permanent FK), so "deleting" a wallet
    // just marks it closed instead.
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "closedAt" timestamptz
    `);

    // SUPER_ADMIN sits above ADMIN: promote/demote other admins and manage
    // wallet types. Postgres enum values can only be added, not removed, in
    // place — see down() for the full rebuild needed to undo this.
    await queryRunner.query(
      `ALTER TYPE "users_role_enum" ADD VALUE 'SUPER_ADMIN'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres can't drop a single enum value, so rebuild the type without it.
    // Any user still holding SUPER_ADMIN is demoted to ADMIN first so the
    // column conversion below never hits a value the new type doesn't have.
    await queryRunner.query(`
      UPDATE "users" SET "role" = 'ADMIN' WHERE "role" = 'SUPER_ADMIN'
    `);
    await queryRunner.query(
      `ALTER TYPE "users_role_enum" RENAME TO "users_role_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "users_role_enum" AS ENUM('USER', 'ADMIN')`,
    );
    await queryRunner.query(`
      ALTER TABLE "users" ALTER COLUMN "role" TYPE "users_role_enum"
      USING "role"::text::"users_role_enum"
    `);
    await queryRunner.query(`DROP TYPE "users_role_enum_old"`);

    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "closedAt"`);
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN "restrictedCounterparties"`,
    );
  }
}
