import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPhoneNumber1706400600000 implements MigrationInterface {
  name = 'AddUserPhoneNumber1706400600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "phoneNumber" varchar(20)`,
    );
    // Postgres unique indexes treat NULLs as distinct, so this only enforces
    // uniqueness among users who've actually set one.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_phoneNumber" ON "users" ("phoneNumber")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_phoneNumber"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phoneNumber"`);
  }
}
