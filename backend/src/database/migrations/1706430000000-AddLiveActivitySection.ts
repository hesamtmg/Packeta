import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the new "liveActivity" ADMIN_SECTION (the real-time transactions/
// wallets/GL/settlement feed) to the seeded, non-deletable Full Access
// role's permissions, so every admin currently on that role keeps having
// every section after this section is introduced — same reasoning as
// AddOffboardingSection.
export class AddLiveActivitySection1706430000000
  implements MigrationInterface
{
  name = 'AddLiveActivitySection1706430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "panel_roles"
      SET "permissions" = "permissions" || ',liveActivity'
      WHERE "id" = '00000000-0000-0000-0000-000000000001'
        AND "permissions" NOT LIKE '%liveActivity%'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "panel_roles"
      SET "permissions" = trim(both ',' from replace(',' || "permissions" || ',', ',liveActivity,', ','))
      WHERE "id" = '00000000-0000-0000-0000-000000000001'
    `);
  }
}
