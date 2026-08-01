import { MigrationInterface, QueryRunner } from 'typeorm';

// Links a credit wallet to the repository wallet that funds and backs its
// virtual credit line — see WalletsService.grantCredit.
export class AddRepositoryWalletLink1706407000000 implements MigrationInterface {
  name = 'AddRepositoryWalletLink1706407000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallets" ADD COLUMN "repositoryWalletId" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "wallets"
        ADD CONSTRAINT "FK_wallets_repositoryWalletId"
        FOREIGN KEY ("repositoryWalletId") REFERENCES "wallets"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_wallets_repositoryWalletId" ON "wallets" ("repositoryWalletId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_wallets_repositoryWalletId"`);
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP CONSTRAINT "FK_wallets_repositoryWalletId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wallets" DROP COLUMN "repositoryWalletId"`,
    );
  }
}
