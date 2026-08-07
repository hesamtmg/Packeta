import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisplayAmountFa1706430000000 implements MigrationInterface {
  name = 'AddDisplayAmountFa1706430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_intents"
      ADD "displayAmountFa" varchar(50)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_intents"
      DROP COLUMN "displayAmountFa"
    `);
  }
}
