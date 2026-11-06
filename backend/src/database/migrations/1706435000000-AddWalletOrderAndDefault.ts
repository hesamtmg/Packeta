import { MigrationInterface, QueryRunner } from 'typeorm';

// Customers can arrange their own wallets and mark one of them as their
// default (see WalletsService.reorderForUser / setDefaultForUser).
//  - sortOrder: the wallet's position in its owner's list. Null until the
//    owner first reorders, and for any wallet created afterwards — nulls
//    sort last (by createdAt), so a new wallet lands at the end of the list
//    instead of jumping to the top.
//  - isDefault: at most one per user (partial unique index). The default
//    wallet is the one preselected on the dashboard and the one preferred
//    when someone else's transfer or purchase has to resolve which of this
//    user's wallets receives the money.
export class AddWalletOrderAndDefault1706435000000 implements MigrationInterface {
  name = 'AddWalletOrderAndDefault1706435000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallets" ADD "sortOrder" integer`);
    await queryRunner.query(
      `ALTER TABLE "wallets" ADD "isDefault" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_wallets_one_default_per_user"
        ON "wallets" ("userId") WHERE "isDefault"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_wallets_one_default_per_user"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "isDefault"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "sortOrder"`);
  }
}
