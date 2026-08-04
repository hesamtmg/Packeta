import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PanelRole } from '../../panel-roles/entities/panel-role.entity';

// SUPER_ADMIN sits above ADMIN: it can do everything a regular admin can,
// plus the two things a regular admin can't — promote/demote other admins,
// and manage wallet types (create/edit/delete the "laws" every wallet is
// bound by). SUPER_ADMIN also bypasses the panel-role section system below
// entirely (see SectionGuard) — a regular ADMIN's access to the rest of the
// panel (customers, wallets, transactions, reports, etc.) is scoped by
// whichever ADMIN_SECTIONS their assigned PanelRole grants.
export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  // Which named PanelRole (a reusable bundle of ADMIN_SECTIONS) this
  // account has, meaningful only when role === ADMIN (SUPER_ADMIN bypasses
  // it, USER never checks it). Null means no panel sections beyond the
  // always-visible dashboard — see UsersService.setPanelRole and
  // SectionGuard. Eager-loaded so every findById() carries it without
  // separate plumbing at each call site (e.g. SectionGuard).
  @Column({ type: 'uuid', nullable: true })
  panelRoleId: string | null;

  @ManyToOne(() => PanelRole, { eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'panelRoleId' })
  panelRole: PanelRole | null;

  // Used by the IPG's phone+OTP customer identification step (see
  // PurchaseGatewayController) to look up which account — and therefore
  // which wallets — a phone number belongs to. Optional and self-service;
  // there's no phone-based signup, just a way to attach one afterwards.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNumber: string | null;

  // Self-service profile fields — see UsersService.updateProfile/setAvatar
  // and UsersController's PATCH /users/me/profile, POST /users/me/avatar.
  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  // A personal (not wallet-specific) national ID, distinct from
  // Wallet.nationalCode — that one is captured per credit wallet at grant
  // time for KYC on that specific credit line; this is the account holder's
  // own identity on their profile. Unique when set (see the migration's
  // partial index), same convention as phoneNumber above.
  @Column({ type: 'varchar', length: 10, nullable: true })
  nationalCode: string | null;

  // Filename under uploads/avatars/ (see UsersController.saveAvatar) —
  // served back at GET /uploads/avatars/<filename> via the static file
  // mount in app.module.ts. Null means "show initials" on the frontend.
  @Column({ type: 'varchar', length: 255, nullable: true })
  avatarFilename: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
