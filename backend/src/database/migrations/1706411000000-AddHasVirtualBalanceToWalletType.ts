import { MigrationInterface, QueryRunner } from 'typeorm';

// Whether wallets of a type may carry a manually-set virtual balance at
// creation — a "law" checkbox on WalletType, same pattern as depositable/
// supportsAutoWithdraw. Off by default: a type opts in explicitly (an admin
// checks it for REPOSITORY, for instance) rather than every type silently
// accepting virtualAmount the way CreateWalletDto/UpdateWalletDto already
// did. Does not affect CREDIT wallets, which get their virtualAmount set
// internally by WalletsService.grantCredit (a direct service call, not the
// generic create/update endpoints this flag gates).
export class AddHasVirtualBalanceToWalletType1706411000000 implements MigrationInterface {
  name = 'AddHasVirtualBalanceToWalletType1706411000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
      ADD COLUMN "hasVirtualBalance" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types" DROP COLUMN "hasVirtualBalance"
    `);
  }
}
