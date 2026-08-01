import { MigrationInterface, QueryRunner } from 'typeorm';

// autoWithdrawTimes was originally a per-wallet override; moved to be a
// per-wallet-type "law" instead, consistent with every other capability
// flag (depositable, allowWithdraw, allowP2pOut, etc.) — see the WalletType
// entity. Every wallet of a given type now sweeps on the same schedule.
export class MoveAutoWithdrawTimesToWalletType1706404000000
  implements MigrationInterface
{
  name = 'MoveAutoWithdrawTimesToWalletType1706404000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types" ADD COLUMN "autoWithdrawTimes" varchar(5)[]
    `);
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN "autoWithdrawTimes"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "autoWithdrawTimes" varchar(5)[]
    `);
    await queryRunner.query(
      `ALTER TABLE "wallet_types" DROP COLUMN "autoWithdrawTimes"`,
    );
  }
}
