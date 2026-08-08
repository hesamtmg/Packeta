import { MigrationInterface, QueryRunner } from 'typeorm';

// Granular panel-section permissions for regular ADMIN accounts — see
// backend/src/admin/admin-sections.ts and SectionGuard. SUPER_ADMIN bypasses
// this system entirely, so it's never populated for them.
export class AddUserPanelPermissions1706420000000 implements MigrationInterface {
  name = 'AddUserPanelPermissions1706420000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "permissions" text`,
    );
    // Backfill: every existing ADMIN keeps full access to every section they
    // could already reach today, so this migration doesn't silently lock
    // anyone out — a super-admin can narrow access afterwards.
    await queryRunner.query(`
      UPDATE "users"
      SET "permissions" = 'transactions,wallets,customers,admins,walletTypes,purchase,installments,schedulerLogs,reports'
      WHERE "role" = 'ADMIN'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "permissions"`);
  }
}
