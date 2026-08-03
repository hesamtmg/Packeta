import { MigrationInterface, QueryRunner } from 'typeorm';

// A CREDIT wallet type can now route an installment repayment's fee,
// penalty, and unblock-fee slices to their own dedicated MERCHANT_REPOSITORY
// wallets instead of the credit wallet's main backing repository — see
// TransactionsService.creditFeeSplitLegs / creditInstallmentRepayment /
// collectOverdueFromRepository. installments.feeAmount is new: the fee
// share alone, fixed at generation time like principalAmount, so a
// repayment can recover the principal/fee/penalty breakdown without
// re-deriving it from the wallet type's current (possibly since-changed)
// feePercent — see InstallmentsService.computeRepaymentSplit. Backfilled
// from principalAmount * the owning wallet's current feePercent, the
// closest available approximation for pre-existing rows.
export class AddFeeSplitRepositories1706418000000 implements MigrationInterface {
  name = 'AddFeeSplitRepositories1706418000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        ADD COLUMN "feeRepositoryWalletId" uuid,
        ADD COLUMN "penaltyRepositoryWalletId" uuid,
        ADD COLUMN "unblockFeeRepositoryWalletId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        ADD CONSTRAINT "FK_wallet_types_feeRepositoryWalletId"
        FOREIGN KEY ("feeRepositoryWalletId") REFERENCES "wallets"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        ADD CONSTRAINT "FK_wallet_types_penaltyRepositoryWalletId"
        FOREIGN KEY ("penaltyRepositoryWalletId") REFERENCES "wallets"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        ADD CONSTRAINT "FK_wallet_types_unblockFeeRepositoryWalletId"
        FOREIGN KEY ("unblockFeeRepositoryWalletId") REFERENCES "wallets"("id")
        ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "installments" ADD COLUMN "feeAmount" bigint
    `);
    await queryRunner.query(`
      UPDATE "installments" i
      SET "feeAmount" = FLOOR(
        i."principalAmount" * (COALESCE(wt."feePercent", 0) * 1000) / 100000
      )
      FROM "wallets" w
      JOIN "wallet_types" wt ON wt."id" = w."walletTypeId"
      WHERE w."id" = i."walletId"
    `);
    await queryRunner.query(`
      UPDATE "installments" SET "feeAmount" = 0 WHERE "feeAmount" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "installments" ALTER COLUMN "feeAmount" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "installments" DROP COLUMN "feeAmount"
    `);

    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        DROP CONSTRAINT "FK_wallet_types_unblockFeeRepositoryWalletId"
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        DROP CONSTRAINT "FK_wallet_types_penaltyRepositoryWalletId"
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        DROP CONSTRAINT "FK_wallet_types_feeRepositoryWalletId"
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        DROP COLUMN "unblockFeeRepositoryWalletId",
        DROP COLUMN "penaltyRepositoryWalletId",
        DROP COLUMN "feeRepositoryWalletId"
    `);
  }
}
