import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1706400000000 implements MigrationInterface {
  name = 'InitSchema1706400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "payment_intents_status_enum" AS ENUM(
        'INITIATED', 'AUTHORIZED', 'VERIFIED', 'CANCELED', 'EXPIRED'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "payment_intents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "merchantName" varchar(100) NOT NULL,
        "amount" bigint NOT NULL,
        "displayAmount" varchar(50) NOT NULL,
        "callbackUrl" varchar(500) NOT NULL,
        "status" "payment_intents_status_enum" NOT NULL DEFAULT 'INITIATED',
        "expiresAt" timestamptz NOT NULL,
        "authorizedAt" timestamptz,
        "verifiedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_intents" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "payment_intents"`);
    await queryRunner.query(`DROP TYPE "payment_intents_status_enum"`);
  }
}
