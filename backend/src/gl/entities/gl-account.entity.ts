import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Currency } from '../../currencies/entities/currency.entity';

// The fixed set of GL accounts every currency gets seeded with (see the
// AddGeneralLedger migration) — not user-editable, same reasoning as
// WalletTypeCode: the table is the source of truth, this enum is just used
// to seed and to look accounts up by name in LedgerService.
export enum GlAccountCode {
  // Real money actually sitting at the bank — increases when a deposit is
  // confirmed by ZarinPal, decreases when a withdrawal's rail settlement
  // actually clears.
  BANK_CASH = 'BANK_CASH',
  // What Packeta owes wallet holders in aggregate — every wallet type whose
  // balance is a liability (Buy/Sell/Gift/Merchant/Repository/Support/...)
  // rolls up here. Not broken out per wallet type; the wallets table is
  // already that sub-ledger.
  CUSTOMER_WALLETS = 'CUSTOMER_WALLETS',
  // What customers owe Packeta — a CREDIT-type wallet's negative balance is
  // a receivable, not a liability, so it gets its own asset account rather
  // than folding into CUSTOMER_WALLETS.
  CREDIT_RECEIVABLE = 'CREDIT_RECEIVABLE',
  // Money debited from a customer for a rail-settlement withdrawal whose
  // outcome isn't a confirmed bank debit yet (or, for the mocked providers
  // in place today, whose payout the provider reported as failed) — sits
  // here instead of BANK_CASH until reconciled.
  SETTLEMENT_CLEARING = 'SETTLEMENT_CLEARING',
  // Fee revenue recognized on a purchase/withdrawal fee. Seeded now, not
  // posted to yet — there's no fee field in the code today, this is ready
  // for when one ships.
  FEE_REVENUE = 'FEE_REVENUE',
  // Counterparty for admin ADJUSTMENT postings — a manual balance
  // correction isn't backed by a real cash movement, so it has to hit
  // something.
  LEDGER_ADJUSTMENTS = 'LEDGER_ADJUSTMENTS',
  // Offsetting leg for a repository-backed CREDIT wallet's own mirrored
  // balance posting (see LedgerService.postRepositoryAllocationMirror) —
  // the REPOSITORY's real balance movement is already posted elsewhere
  // (BANK_CASH/merchant/etc), so mirroring the same amount onto the
  // employee's own CREDIT_RECEIVABLE needs a plug on the other side to
  // keep the entry balanced. Purely a bookkeeping bridge with no
  // independent real-world meaning of its own.
  REPOSITORY_ALLOCATIONS = 'REPOSITORY_ALLOCATIONS',
}

export enum GlAccountType {
  ASSET = 'ASSET',
  LIABILITY = 'LIABILITY',
  EQUITY = 'EQUITY',
  REVENUE = 'REVENUE',
}

// One row per (code, currency) pair — mirrors how wallet_types is denominated
// in exactly one currency per row, for the same reason: a balance only means
// something in one currency's scale.
@Entity('gl_accounts')
@Index(['code', 'currencyId'], { unique: true })
export class GlAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: GlAccountCode })
  code: GlAccountCode;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'enum', enum: GlAccountType })
  type: GlAccountType;

  @Column({ type: 'uuid' })
  currencyId: string;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currencyId' })
  currency: Currency;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
