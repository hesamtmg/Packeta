import { MigrationInterface, QueryRunner } from 'typeorm';

// Super-admin-selectable real-money gateway (ZarinPal or Sadad):
//   - platform_settings holds the active provider (see PaymentGatewayService),
//   - transactions.ipgProvider records which gateway issued each payment so
//     it's verified with the same one. Existing rows stay NULL = ZarinPal.
export class AddPaymentGatewaySelection1706433000000 implements MigrationInterface {
  name = 'AddPaymentGatewaySelection1706433000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "platform_settings" ("key" character varying(100) NOT NULL, "value" character varying(500) NOT NULL, "updatedByUserId" uuid, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_platform_settings_key" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN "ipgProvider" character varying(20)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "ipgProvider"`,
    );
    await queryRunner.query(`DROP TABLE "platform_settings"`);
  }
}
