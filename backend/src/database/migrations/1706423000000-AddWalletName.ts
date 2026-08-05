import { MigrationInterface, QueryRunner } from 'typeorm';

// A customer-chosen display name for one of their own wallets (e.g. "Rent
// savings", "Shop till") — purely cosmetic, shown wherever the wallet type
// name was shown before (wallet cards, transaction from/to, transaction
// detail). Null means "no custom name yet", in which case every display
// falls back to the wallet type's name, same as pre-migration behavior.
export class AddWalletName1706423000000 implements MigrationInterface {
  name = 'AddWalletName1706423000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD "name" character varying(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallets" DROP COLUMN "name"
    `);
  }
}
