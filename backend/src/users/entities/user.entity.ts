import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// SUPER_ADMIN sits above ADMIN: it can do everything a regular admin can,
// plus the two things a regular admin can't — promote/demote other admins,
// and manage wallet types (create/edit/delete the "laws" every wallet is
// bound by). A regular admin still handles everything else (customers,
// wallets, transactions, balance adjustments, reports) exactly as before.
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
