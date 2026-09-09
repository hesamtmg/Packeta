import { MigrationInterface, QueryRunner } from 'typeorm';

// Lets a wallet type carry its own card appearance instead of every wallet
// of that type falling back to an automatically-hashed gradient: cardColor
// is a preset key (see frontend utils/cardTheme.ts's CARD_THEME_OPTIONS,
// the single source of truth both the admin picker and the customer-facing
// card read from) and cardImageFilename is an uploaded logo shown where the
// generic two-circle brand mark otherwise sits (see WalletTypesController's
// card-image upload endpoint, mirroring UsersController's avatar upload).
// Both null by default so every existing type keeps rendering exactly as
// before this migration — the hash-based fallback and generic mark.
export class AddWalletTypeCardAppearance1706430000000 implements MigrationInterface {
  name = 'AddWalletTypeCardAppearance1706430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types" ADD "cardColor" varchar(32)
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types" ADD "cardImageFilename" varchar(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types" DROP COLUMN "cardImageFilename"
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types" DROP COLUMN "cardColor"
    `);
  }
}
