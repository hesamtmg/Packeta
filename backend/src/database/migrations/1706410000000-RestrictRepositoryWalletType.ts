import { MigrationInterface, QueryRunner } from 'typeorm';

// REPOSITORY wallets are pools of virtual credit an owner grants out (see
// WalletsService.grantCredit) — they were never meant to be withdrawable or
// settlement-swept, only funded via IPG deposit (real balance) or manually
// (virtual balance). WalletTypesService now rejects allowWithdraw/
// supportsAutoWithdraw on the REPOSITORY code going forward; this is a
// data-only fix for any REPOSITORY row created before that check existed.
export class RestrictRepositoryWalletType1706410000000 implements MigrationInterface {
  name = 'RestrictRepositoryWalletType1706410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "wallet_types"
      SET "allowWithdraw" = false,
          "supportsAutoWithdraw" = false,
          "autoWithdrawTimes" = NULL
      WHERE "code" = 'REPOSITORY'
    `);
  }

  public async down(): Promise<void> {
    // Data-only fix — no meaningful rollback (the prior values weren't
    // recorded and shouldn't be restored anyway).
  }
}
