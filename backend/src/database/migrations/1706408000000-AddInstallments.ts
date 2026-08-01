import { MigrationInterface, QueryRunner } from 'typeorm';

// The installment engine: repaying a granted credit line
// (WalletsService.grantCredit) back to its repository over
// WalletType.installmentCount scheduled installments — see
// InstallmentsService and TransactionsService.payInstallment.
export class AddInstallments1706408000000 implements MigrationInterface {
  name = 'AddInstallments1706408000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Frozen (can no longer spend/withdraw/transfer/purchase-out) after
    // missing an installment's payment deadline — cleared once the
    // outstanding installment plus the type's unblockFee is paid.
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "blockedAt" timestamptz
    `);

    // Links a repayment PURCHASE transaction back to the installment it
    // pays off, so verifyPurchase can mark the installment PAID and clear
    // the wallet block once the IPG payment is confirmed.
    await queryRunner.query(`
      ALTER TABLE "transactions" ADD COLUMN "installmentId" uuid
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_installmentId" ON "transactions" ("installmentId")`,
    );

    await queryRunner.query(
      `CREATE TYPE "installments_status_enum" AS ENUM('PENDING', 'OVERDUE', 'PAID')`,
    );
    await queryRunner.query(`
      CREATE TABLE "installments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "walletId" uuid NOT NULL,
        "sequenceNumber" smallint NOT NULL,
        "amount" bigint NOT NULL,
        "penaltyApplied" boolean NOT NULL DEFAULT false,
        "dueDate" date NOT NULL,
        "deadlineDate" date NOT NULL,
        "status" "installments_status_enum" NOT NULL DEFAULT 'PENDING',
        "paidAt" timestamptz,
        "paymentTransactionId" uuid,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_installments_wallet" FOREIGN KEY ("walletId") REFERENCES "wallets"("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_installments_walletId" ON "installments" ("walletId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ADD CONSTRAINT "FK_transactions_installmentId" FOREIGN KEY ("installmentId") REFERENCES "installments"("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_transactions_installmentId"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_installments_walletId"`);
    await queryRunner.query(`DROP TABLE "installments"`);
    await queryRunner.query(`DROP TYPE "installments_status_enum"`);
    await queryRunner.query(`DROP INDEX "IDX_transactions_installmentId"`);
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "installmentId"`,
    );
    await queryRunner.query(`ALTER TABLE "wallets" DROP COLUMN "blockedAt"`);
  }
}
