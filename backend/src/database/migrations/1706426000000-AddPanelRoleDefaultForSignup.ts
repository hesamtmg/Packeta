import { MigrationInterface, QueryRunner } from 'typeorm';

// Mirrors WalletType.isStarterType: lets a super-admin mark one Panel Role
// as the one every new self-service signup gets assigned automatically
// (see PanelRolesService.findDefaultForSignup and AuthService.signup /
// verifyPhoneOtp). At most one role can be the default at a time —
// enforced in PanelRolesService.create/update, not at the DB level, same
// reasoning as Currency.isDefault.
export class AddPanelRoleDefaultForSignup1706426000000 implements MigrationInterface {
  name = 'AddPanelRoleDefaultForSignup1706426000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "panel_roles" ADD COLUMN "isDefaultForSignup" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "panel_roles" DROP COLUMN "isDefaultForSignup"`,
    );
  }
}
