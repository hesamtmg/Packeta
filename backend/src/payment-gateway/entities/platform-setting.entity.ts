import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Small key/value store for platform-wide switches a super-admin flips from
// the admin panel at runtime (no redeploy) — currently just which real-money
// payment gateway new payments go through (see PaymentGatewayService).
// Secrets never live here: gateway credentials stay in env vars.
@Entity('platform_settings')
export class PlatformSetting {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'varchar', length: 500 })
  value: string;

  @Column({ type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
