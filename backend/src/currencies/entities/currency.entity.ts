import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum SymbolPosition {
  PREFIX = 'PREFIX',
  SUFFIX = 'SUFFIX',
}

// Currency is data, same reasoning as wallet_types: decimal precision and
// display symbol vary per currency (USD has cents, Rial doesn't use
// subdivisions in practice), so amounts are formatted using these columns
// rather than a hardcoded assumption.
@Entity('currencies')
export class Currency {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 8 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 8 })
  symbol: string;

  @Column({ type: 'enum', enum: SymbolPosition })
  symbolPosition: SymbolPosition;

  @Column({ type: 'smallint' })
  decimalPlaces: number;

  // Exactly one currency should have this set — it's what signup uses to
  // decide the default starter wallet set, so adding a new currency doesn't
  // silently expand every existing user's wallets.
  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
