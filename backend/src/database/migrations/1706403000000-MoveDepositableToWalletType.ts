import { MigrationInterface, QueryRunner } from 'typeorm';

// depositable was originally a per-wallet override; moved to be a
// per-wallet-type "law" instead, consistent with every other capability
// flag (allowWithdraw, allowP2pOut, etc.) — see the WalletType entity.
export class MoveDepositableToWalletType1706403000000 implements MigrationInterface {
  name = 'MoveDepositableToWalletType1706403000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types" ADD COLUMN "depositable" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "depositable"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "depositable" boolean NOT NULL DEFAULT true
    `);
    await queryRunner.query(
      `ALTER TABLE "wallet_types" DROP COLUMN "depositable"`,
    );
  }
}
