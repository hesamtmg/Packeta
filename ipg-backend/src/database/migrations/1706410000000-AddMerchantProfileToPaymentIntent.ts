import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantProfileToPaymentIntent1706410000000
  implements MigrationInterface
{
  name = 'AddMerchantProfileToPaymentIntent1706410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_intents"
      ADD "terminalId" varchar(100),
      ADD "acceptorCode" varchar(100),
      ADD "storeSite" varchar(500),
      ADD "category" varchar(100),
      ADD "subCategory" varchar(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_intents"
      DROP COLUMN "terminalId",
      DROP COLUMN "acceptorCode",
      DROP COLUMN "storeSite",
      DROP COLUMN "category",
      DROP COLUMN "subCategory"
    `);
  }
}
