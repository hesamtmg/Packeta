import { MigrationInterface, QueryRunner } from 'typeorm';

// Lets a wallet type be hidden from a customer's own wallets/transactions
// lists (dashboard "Wallets" grid, "All transactions" table) while staying
// fully visible and functional everywhere in the admin panel — for internal
// wallet types (e.g. a repository or support wallet) a customer shouldn't
// need to see day-to-day. Off by default so every existing type keeps
// showing up exactly as before this migration.
export class AddWalletTypeHiddenFromCustomer1706424000000
  implements MigrationInterface
{
  name = 'AddWalletTypeHiddenFromCustomer1706424000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types" ADD "hiddenFromCustomer" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types" DROP COLUMN "hiddenFromCustomer"
    `);
  }
}
