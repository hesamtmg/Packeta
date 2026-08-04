import { MigrationInterface, QueryRunner } from 'typeorm';

// Replaces the flat User.permissions array (added in
// AddUserPanelPermissions) with named, reusable Roles — a role bundles a
// set of ADMIN_SECTIONS once, and any number of ADMIN accounts can be
// assigned it via users.panelRoleId. See PanelRolesService and
// backend/src/admin/admin-sections.ts's FULL_ACCESS_ROLE_ID.
export class AddPanelRoles1706421000000 implements MigrationInterface {
  name = 'AddPanelRoles1706421000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "panel_roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(100) NOT NULL,
        "permissions" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_panel_roles" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_panel_roles_name" ON "panel_roles" ("name")`,
    );

    // The seeded, non-deletable "Full Access" role — same permission set
    // every ADMIN got from the previous migration's backfill, now as a
    // named role instead of a copy pasted onto every row.
    await queryRunner.query(`
      INSERT INTO "panel_roles" ("id", "name", "permissions")
      VALUES (
        '00000000-0000-0000-0000-000000000001',
        'Full Access',
        'transactions,wallets,customers,admins,walletTypes,purchase,installments,schedulerLogs,reports,roles'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "panelRoleId" uuid,
        ADD CONSTRAINT "FK_users_panelRoleId" FOREIGN KEY ("panelRoleId")
          REFERENCES "panel_roles"("id") ON DELETE SET NULL
    `);

    // Every existing ADMIN had every section from the last migration's
    // backfill — carry that forward as an assignment to Full Access so
    // nobody's access changes.
    await queryRunner.query(`
      UPDATE "users"
      SET "panelRoleId" = '00000000-0000-0000-0000-000000000001'
      WHERE "role" = 'ADMIN'
    `);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "permissions"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "permissions" text`,
    );
    await queryRunner.query(`
      UPDATE "users" u
      SET "permissions" = r."permissions"
      FROM "panel_roles" r
      WHERE u."panelRoleId" = r."id"
    `);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "FK_users_panelRoleId"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "panelRoleId"`);
    await queryRunner.query(`DROP INDEX "IDX_panel_roles_name"`);
    await queryRunner.query(`DROP TABLE "panel_roles"`);
  }
}
