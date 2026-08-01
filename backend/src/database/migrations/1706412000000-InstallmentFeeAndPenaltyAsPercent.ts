import { MigrationInterface, QueryRunner } from 'typeorm';

// Turns the credit-line "fee" and "penalty" from flat minor-unit amounts
// into percentages: feePercent (of each installment's principal share,
// charged once at generation) and penaltyPercentPerDay (of that same
// principal, accrued once for every day an installment stays unpaid past
// its deadline instead of a single flat add) — see InstallmentsService.
// Existing flat fee/penalty values have no meaningful percentage
// equivalent (they were minor-unit amounts on possibly-differing principal
// sizes), so this is a lossy, one-way conversion — every wallet type simply
// starts at 0%/unset and an admin re-configures it.
//
// installments.principalAmount is new: the fee/penalty base, fixed at
// generation time so daily penalty accrual doesn't compound on itself.
// Backfilled from the existing `amount` column (the closest available
// approximation for pre-existing rows, which already included whatever
// flat fee/penalty had been folded in).
export class InstallmentFeeAndPenaltyAsPercent1706412000000 implements MigrationInterface {
  name = 'InstallmentFeeAndPenaltyAsPercent1706412000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        DROP COLUMN "fee",
        DROP COLUMN "penalty"
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        ADD COLUMN "feePercent" numeric(6,3),
        ADD COLUMN "penaltyPercentPerDay" numeric(6,3)
    `);

    await queryRunner.query(`
      ALTER TABLE "installments" ADD COLUMN "principalAmount" bigint
    `);
    await queryRunner.query(`
      UPDATE "installments" SET "principalAmount" = "amount"
    `);
    await queryRunner.query(`
      ALTER TABLE "installments" ALTER COLUMN "principalAmount" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "installments"
        ADD COLUMN "penaltyDaysApplied" smallint NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "installments" DROP COLUMN "penaltyDaysApplied"
    `);
    await queryRunner.query(`
      ALTER TABLE "installments" DROP COLUMN "principalAmount"
    `);

    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        DROP COLUMN "feePercent",
        DROP COLUMN "penaltyPercentPerDay"
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types"
        ADD COLUMN "fee" bigint,
        ADD COLUMN "penalty" bigint
    `);
  }
}
