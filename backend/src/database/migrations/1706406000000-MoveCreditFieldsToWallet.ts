import { MigrationInterface, QueryRunner } from 'typeorm';

// virtualAmount and nationalCode are per-person, unlike the rest of the
// credit-line fields (fee, penalty, unblockFee, installmentDate,
// paymentDeadlineDate, installmentCount) which are shared billing rules —
// see the WalletType/Wallet entities.
export class MoveCreditFieldsToWallet1706406000000 implements MigrationInterface {
  name = 'MoveCreditFieldsToWallet1706406000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallets"
        ADD COLUMN "virtualAmount" bigint,
        ADD COLUMN "nationalCode" varchar(10)
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        DROP COLUMN "virtualAmount",
        DROP COLUMN "nationalCode"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        ADD COLUMN "virtualAmount" bigint,
        ADD COLUMN "nationalCode" varchar(10)
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets"
        DROP COLUMN "virtualAmount",
        DROP COLUMN "nationalCode"
    `);
  }
}
