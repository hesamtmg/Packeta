import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisplayAmountWords1706420000000 implements MigrationInterface {
  name = 'AddDisplayAmountWords1706420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_intents"
      ADD "displayAmountWordsEn" varchar(200),
      ADD "displayAmountWordsFa" varchar(200)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_intents"
      DROP COLUMN "displayAmountWordsEn",
      DROP COLUMN "displayAmountWordsFa"
    `);
  }
}
