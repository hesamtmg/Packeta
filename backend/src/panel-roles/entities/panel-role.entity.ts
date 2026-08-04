import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// A named, reusable bundle of ADMIN_SECTIONS — assigned to regular ADMIN
// accounts via User.panelRoleId instead of toggling sections one admin at a
// time. Editing a role's permissions here changes access for every admin
// currently assigned to it. SUPER_ADMIN accounts never reference a role —
// they bypass the section system entirely (see SectionGuard).
@Entity('panel_roles')
export class PanelRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'simple-array' })
  permissions: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
