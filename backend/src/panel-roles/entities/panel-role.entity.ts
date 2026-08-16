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

  // At most one role may have this set — enforced in PanelRolesService, not
  // at the DB level (same reasoning as Currency.isDefault). The role marked
  // here is auto-assigned as the panelRoleId of every new self-service
  // signup (see PanelRolesService.findDefaultForSignup).
  @Column({ type: 'boolean', default: false })
  isDefaultForSignup: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
