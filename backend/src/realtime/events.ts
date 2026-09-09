// Event names + payload shapes for the admin "Live Activity" feed
// (RealtimeGateway, namespace /admin-live). Producers inject EventEmitter2
// (global via EventEmitterModule.forRoot() in app.module.ts) and emit these
// after their own DB transaction resolves; RealtimeGateway listens via
// @OnEvent(...) and rebroadcasts to every socket in the 'admin-live' room.
// This is a monitoring feed, not a source of truth — see the GL posting
// hook's doc comment in ledger.service.ts for the one accepted trade-off.

export enum RealtimeEvent {
  TRANSACTION_CREATED = 'transaction.created',
  TRANSACTION_STATUS_CHANGED = 'transaction.status_changed',
  WALLET_BALANCE_CHANGED = 'wallet.balance_changed',
  GL_POSTING_CREATED = 'gl.posting_created',
  SETTLEMENT_ACTIVITY = 'settlement.activity',
  INSTALLMENT_ACTIVITY = 'installment.activity',
}

export interface TransactionCreatedEvent {
  id: string;
  type: string;
  status: string;
  action: string;
  fromWalletId: string | null;
  toWalletId: string | null;
  amount: string;
  userId?: string | null;
  createdAt: string;
}

export interface TransactionStatusChangedEvent {
  id: string;
  type: string;
  status: string;
  reason?: string;
  updatedAt: string;
}

export interface WalletBalanceChangedEvent {
  walletId: string;
  delta: string;
  transactionId: string;
  description: string;
  at: string;
}

export interface GlPostingCreatedEvent {
  journalEntryId: string;
  transactionId: string;
  description: string;
  postings: Array<{
    accountCode: string;
    walletId: string | null;
    direction: string;
    amount: string;
  }>;
  at: string;
}

export interface SettlementActivityEvent {
  walletId: string;
  railType?: string | null;
  transactionIds: string[];
  currentTime: string;
  at: string;
}

export interface InstallmentActivityEvent {
  kind: 'generated' | 'overdue_penalty';
  count: number;
  installmentIds?: string[];
  at: string;
}
