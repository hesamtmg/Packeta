import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreditWalletTypeFields1706405000000 implements MigrationInterface {
  name = 'AddCreditWalletTypeFields1706405000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        ADD COLUMN "virtualAmount" bigint,
        ADD COLUMN "installmentDate" smallint,
        ADD COLUMN "paymentDeadlineDate" smallint,
        ADD COLUMN "fee" bigint,
        ADD COLUMN "penalty" bigint,
        ADD COLUMN "unblockFee" bigint,
        ADD COLUMN "nationalCode" varchar(10),
        ADD COLUMN "installmentCount" smallint
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        DROP COLUMN "virtualAmount",
        DROP COLUMN "installmentDate",
        DROP COLUMN "paymentDeadlineDate",
        DROP COLUMN "fee",
        DROP COLUMN "penalty",
        DROP COLUMN "unblockFee",
        DROP COLUMN "nationalCode",
        DROP COLUMN "installmentCount"
    `);
  }
}
