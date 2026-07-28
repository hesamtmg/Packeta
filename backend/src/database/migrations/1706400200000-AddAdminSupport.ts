import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminSupport1706400200000 implements MigrationInterface {
  name = 'AddAdminSupport1706400200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "users_role_enum" AS ENUM('USER', 'ADMIN')`,
    );
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "role" "users_role_enum" NOT NULL DEFAULT 'USER'
    `);

    // Admin-initiated manual balance corrections get their own ledger type,
    // distinct from the three ordinary user-initiated ones.
    await queryRunner.query(
      `ALTER TYPE "transactions_type_enum" ADD VALUE 'ADJUSTMENT'`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN "note" varchar(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN "performedByUserId" uuid`,
    );
    await queryRunner.query(`
      ALTER TABLE "transactions" ADD CONSTRAINT "FK_transactions_performedBy"
      FOREIGN KEY ("performedByUserId") REFERENCES "users"("id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_transactions_performedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "performedByUserId"`,
    );
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "note"`);

    // Postgres can't drop a single enum value, so rebuild the type without it.
    await queryRunner.query(
      `ALTER TYPE "transactions_type_enum" RENAME TO "transactions_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "transactions_type_enum" AS ENUM('DEPOSIT', 'WITHDRAW', 'TRANSFER')`,
    );
    await queryRunner.query(`
      ALTER TABLE "transactions" ALTER COLUMN "type" TYPE "transactions_type_enum"
      USING "type"::text::"transactions_type_enum"
    `);
    await queryRunner.query(`DROP TYPE "transactions_type_enum_old"`);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`DROP TYPE "users_role_enum"`);
  }
}
