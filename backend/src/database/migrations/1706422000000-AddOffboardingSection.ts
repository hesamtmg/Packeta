import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the new "offboarding" ADMIN_SECTION (the "quit a customer" page) to
// the seeded, non-deletable Full Access role's permissions, so every admin
// currently on that role keeps having every section after this section is
// introduced — same reasoning as AddPanelRoles' initial seed.
export class AddOffboardingSection1706422000000 implements MigrationInterface {
  name = 'AddOffboardingSection1706422000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "panel_roles"
      SET "permissions" = "permissions" || ',offboarding'
      WHERE "id" = '00000000-0000-0000-0000-000000000001'
        AND "permissions" NOT LIKE '%offboarding%'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "panel_roles"
      SET "permissions" = trim(both ',' from replace(',' || "permissions" || ',', ',offboarding,', ','))
      WHERE "id" = '00000000-0000-0000-0000-000000000001'
    `);
  }
}
