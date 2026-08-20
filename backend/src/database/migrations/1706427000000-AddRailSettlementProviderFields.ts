import { MigrationInterface, QueryRunner } from 'typeorm';

// Rail settlement payouts now call out to a (mocked, pending real API
// credentials) per-rail provider client at the end of the withdraw process
// — see RailSettlementsService.createForSweep and rail-settlements/providers/.
// These columns persist whatever that provider answered with.
export class AddRailSettlementProviderFields1706427000000 implements MigrationInterface {
  name = 'AddRailSettlementProviderFields1706427000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rail_settlements" ADD COLUMN "providerReference" character varying(100)
    `);
    await queryRunner.query(`
      ALTER TABLE "rail_settlements" ADD COLUMN "providerResponse" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "rail_settlements" DROP COLUMN "providerResponse"`,
    );
    await queryRunner.query(
      `ALTER TABLE "rail_settlements" DROP COLUMN "providerReference"`,
    );
  }
}
