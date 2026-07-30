import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTransactionLanguage1706400700000 implements MigrationInterface {
  name = 'AddTransactionLanguage1706400700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN "language" varchar(5)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "language"`,
    );
  }
}
