import { MigrationInterface, QueryRunner } from 'typeorm';

// Self-service profile fields for UsersController's PATCH /users/me/profile
// and POST /users/me/avatar — see UsersService.updateProfile/setAvatar.
export class AddUserProfileFields1706419000000 implements MigrationInterface {
  name = 'AddUserProfileFields1706419000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "name" varchar(255),
        ADD COLUMN "nationalCode" varchar(10),
        ADD COLUMN "avatarFilename" varchar(255)
    `);
    // Nullable + unique: any number of accounts can leave it unset, but once
    // set it must be this account's alone — mirrors how phoneNumber's own
    // unique index already behaves.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_nationalCode" ON "users" ("nationalCode") WHERE "nationalCode" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_nationalCode"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "avatarFilename",
        DROP COLUMN "nationalCode",
        DROP COLUMN "name"
    `);
  }
}
