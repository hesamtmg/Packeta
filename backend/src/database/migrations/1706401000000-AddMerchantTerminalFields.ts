import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantTerminalFields1706401000000 implements MigrationInterface {
  name = 'AddMerchantTerminalFields1706401000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Merchant wallets only: the PSP terminal/acceptor identifiers this
    // wallet settles under — purely descriptive, see the Wallet entity.
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "terminalId" varchar(100)
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "acceptorCode" varchar(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "acceptorCode"`);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "terminalId"`);
  }
}
