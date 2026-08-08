import { MigrationInterface, QueryRunner } from 'typeorm';

// Wallet-viewing widget feature: a merchant embeds a script on their own
// site that shows a customer's own wallets inline (see backend/src/widget).
// Two wallet_types columns gate it (off by default, so every existing type
// keeps behaving exactly as before this migration), plus the sessions table
// backing the short-lived tokens a merchant's own backend mints server-side
// and hands to the browser — the same "authority"-scoped-token shape the
// purchase flow already uses, just for a different purpose.
export class AddWidgetSessions1706425000000 implements MigrationInterface {
  name = 'AddWidgetSessions1706425000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallet_types" ADD "allowWidget" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types" ADD "widgetRequiresOtp" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      CREATE TYPE "widget_sessions_status_enum" AS ENUM('PENDING', 'AUTHENTICATED', 'EXPIRED')
    `);
    await queryRunner.query(`
      CREATE TABLE "widget_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "walletId" uuid NOT NULL,
        "token" varchar NOT NULL,
        "phoneNumber" varchar,
        "userId" uuid,
        "status" "widget_sessions_status_enum" NOT NULL DEFAULT 'PENDING',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "expiresAt" timestamptz NOT NULL,
        CONSTRAINT "PK_widget_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_widget_sessions_token" UNIQUE ("token"),
        CONSTRAINT "FK_widget_sessions_wallet" FOREIGN KEY ("walletId")
          REFERENCES "wallets"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_widget_sessions_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_widget_sessions_token" ON "widget_sessions" ("token")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "widget_sessions"`);
    await queryRunner.query(`DROP TYPE "widget_sessions_status_enum"`);
    await queryRunner.query(`
      ALTER TABLE "wallet_types" DROP COLUMN "widgetRequiresOtp"
    `);
    await queryRunner.query(`
      ALTER TABLE "wallet_types" DROP COLUMN "allowWidget"
    `);
  }
}
