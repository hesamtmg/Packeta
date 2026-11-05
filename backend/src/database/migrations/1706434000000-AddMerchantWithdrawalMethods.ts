import { MigrationInterface, QueryRunner } from 'typeorm';

// Super-admin-managed payout methods for merchant wallet types: each rail
// (Pol Pay / Paya / Satna / bank transfer) can be enabled or disabled per
// wallet type, with its own fee (percent + fixed) and the
// MERCHANT_REPOSITORY wallet that fee is transferred into — see
// WalletType.withdrawalMethods and TransactionsService.sweepAutoWithdraw.
// rail_settlements now also records the fee withheld from each payout.
export class AddMerchantWithdrawalMethods1706434000000 implements MigrationInterface {
  name = 'AddMerchantWithdrawalMethods1706434000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallet_types" ADD COLUMN "withdrawalMethods" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "rail_settlements" ADD COLUMN "feeAmount" bigint NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "rail_settlements" ADD COLUMN "feeTransactionId" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "rail_settlements"
        ADD CONSTRAINT "FK_rail_settlements_feeTransaction" FOREIGN KEY ("feeTransactionId") REFERENCES "transactions"("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rail_settlements" DROP CONSTRAINT "FK_rail_settlements_feeTransaction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rail_settlements" DROP COLUMN "feeTransactionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rail_settlements" DROP COLUMN "feeAmount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallet_types" DROP COLUMN "withdrawalMethods"`,
    );
  }
}
