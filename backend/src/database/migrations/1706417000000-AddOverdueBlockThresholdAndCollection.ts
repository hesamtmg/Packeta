import { MigrationInterface, QueryRunner } from 'typeorm';

// Two additions for the overdue-installment collection flow:
//   - wallet_types.overdueDaysBeforeBlock: how many days an installment may
//     sit OVERDUE before the wallet is actually blocked (see
//     InstallmentsService.applyOverduePenalties) — missing the deadline
//     alone no longer blocks immediately.
//   - transactions.settlesWalletId: links an admin-triggered ZarinPal
//     collection payment (see TransactionsService
//     .initiateOverdueCollectionZarinPal) back to the CREDIT wallet whose
//     entire outstanding balance it settles.
export class AddOverdueBlockThresholdAndCollection1706417000000 implements MigrationInterface {
  name = 'AddOverdueBlockThresholdAndCollection1706417000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types" ADD COLUMN "overdueDaysBeforeBlock" smallint
    `);

    await queryRunner.query(`
      ALTER TABLE "transactions" ADD COLUMN "settlesWalletId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ADD CONSTRAINT "FK_transactions_settlesWalletId"
        FOREIGN KEY ("settlesWalletId") REFERENCES "wallets"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_settlesWalletId" ON "transactions" ("settlesWalletId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_transactions_settlesWalletId"`);
    await queryRunner.query(`
      ALTER TABLE "transactions" DROP CONSTRAINT "FK_transactions_settlesWalletId"
    `);
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "settlesWalletId"`,
    );

    await queryRunner.query(
      `ALTER TABLE "wallet_types" DROP COLUMN "overdueDaysBeforeBlock"`,
    );
  }
}
