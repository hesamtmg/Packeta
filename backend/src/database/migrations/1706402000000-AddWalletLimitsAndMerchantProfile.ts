import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalletLimitsAndMerchantProfile1706402000000 implements MigrationInterface {
  name = 'AddWalletLimitsAndMerchantProfile1706402000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // All wallets: an optional per-transaction amount band (minor units) and
    // whether this wallet accepts deposits at all.
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "minTransactionAmount" bigint
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "maxTransactionAmount" bigint
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "depositable" boolean NOT NULL DEFAULT true
    `);

    // Merchant wallets only: storefront identity + access controls shown on
    // the IPG pay page / enforced on self-service charge creation.
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "storeName" varchar(150)
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "storeSite" varchar(500)
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "allowedIps" varchar(64)[]
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "callbackUrl" varchar(500)
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "category" varchar(100)
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "subCategory" varchar(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "subCategory"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "category"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "callbackUrl"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "allowedIps"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "storeSite"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "storeName"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "depositable"`);
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN "maxTransactionAmount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN "minTransactionAmount"`,
    );
  }
}
