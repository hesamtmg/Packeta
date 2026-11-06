import { defineStore } from 'pinia';
import { apiRequest } from '../api/client';
import type { CurrencyInfo } from '../utils/currency';

export interface WalletType {
  id: string;
  code: string;
  name: string;
  currency: CurrencyInfo;
  // Card appearance (see utils/cardTheme.ts) — both null until an admin
  // sets them on this wallet type, at which point every wallet of this
  // type picks them up automatically.
  cardColor: string | null;
  cardImageFilename: string | null;
  allowNegativeBalance: boolean;
  creditLimit: string | null;
  allowWithdraw: boolean;
  allowP2pOut: boolean;
  allowP2pIn: boolean;
  supportsAutoWithdraw: boolean;
  autoWithdrawTimes: string[] | null;
  allowPurchaseOut: boolean;
  allowPurchaseIn: boolean;
  depositable: boolean;
  // Whether wallets of this type may carry a manually-set virtual balance at
  // creation (see the "Add wallet" form's virtual-amount field).
  hasVirtualBalance: boolean;
  // Wallet-viewing widget feature (see sdk/js/wallet-widget.js) — only
  // meaningful on MERCHANT-code types.
  allowWidget: boolean;
  // Credit-line fields (repository/credit wallet feature) — shared billing
  // rules for every wallet of this type.
  installmentDate: number | null;
  paymentDeadlineDate: number | null;
  feePercent: string | null;
  penaltyPercentPerDay: string | null;
  unblockFee: string | null;
  installmentCount: number | null;
  // Merchant types: the payout rails the super admin allows and the fee each
  // charges per payout (see utils/withdrawalMethods.ts). Null = every rail,
  // no fee.
  withdrawalMethods?: WithdrawalMethod[] | null;
}

export interface WithdrawalMethod {
  railType: SettlementRailType;
  enabled: boolean;
  // Percent of each payout, as a numeric string.
  feePercent: string;
  // Flat fee per payout, minor units.
  fixedFee: string;
}

export interface SettlementAccount {
  id: string;
  iban: string;
  label: string | null;
  percent: string;
}

// Withdrawal-schedule rail: which of Iran's interbank rails the
// auto-withdraw sweep pays this wallet out over, and when.
export type SettlementRailType = 'POL_PAY' | 'PAYA' | 'SATNA' | 'BANK_TRANSFER';

export interface RailSettlement {
  id: string;
  walletId: string;
  railType: SettlementRailType;
  amount: string;
  // Fee withheld from this payout by its withdrawal method; `amount` is net.
  feeAmount?: string;
  destinationIban: string | null;
  label: string | null;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  scheduledFor: string;
  processedAt: string | null;
  transactionId: string | null;
  createdAt: string;
}

export interface Wallet {
  id: string;
  name: string | null;
  balance: string;
  // The owner's chosen default wallet (at most one) — preselected on the
  // dashboard and preferred when someone sends this user money.
  isDefault: boolean;
  // Position in the owner's own arrangement; null until first reordered.
  // The list from GET /wallets already comes back in this order.
  sortOrder: number | null;
  purchaseTimeoutSeconds: number | null;
  restrictedCounterparties: string[] | null;
  closedAt: string | null;
  blockedAt: string | null;
  terminalId: string | null;
  acceptorCode: string | null;
  minTransactionAmount: string | null;
  maxTransactionAmount: string | null;
  storeName: string | null;
  storeSite: string | null;
  allowedIps: string[] | null;
  callbackUrl: string | null;
  category: string | null;
  subCategory: string | null;
  // Credit-line fields (repository/credit wallet feature) — per-wallet,
  // unlike the shared billing rules on WalletType.
  virtualAmount: string | null;
  nationalCode: string | null;
  repositoryWalletId: string | null;
  railType: SettlementRailType | null;
  railScheduleTimes: string[] | null;
  settlementAccounts?: SettlementAccount[];
  walletType: WalletType;
  createdAt: string;
}

export interface WalletOptionsInput {
  name?: string;
  purchaseTimeoutSeconds?: number;
  settlementAccounts?: SettlementAccountInput[];
  restrictedCounterparties?: string[];
  terminalId?: string;
  acceptorCode?: string;
  minTransactionAmount?: number;
  maxTransactionAmount?: number;
  storeName?: string;
  storeSite?: string;
  allowedIps?: string[];
  callbackUrl?: string;
  category?: string;
  subCategory?: string;
  virtualAmount?: number;
  nationalCode?: string;
  railType?: SettlementRailType;
  railScheduleTimes?: string[];
}

export interface GrantCreditInput {
  repositoryWalletId: string;
  personnelPhoneNumber: string;
  walletTypeId: string;
  virtualAmount: number;
  nationalCode?: string;
}

export interface SettlementAccountInput {
  iban: string;
  label?: string;
  percent: number;
}

export interface SettlementSplitInput {
  iban: string;
  label?: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
}

interface Transaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER' | 'ADJUSTMENT' | 'PURCHASE' | 'VIRTUAL';
  status: 'PENDING' | 'COMPLETED' | 'REVERSED';
  fromWalletId: string | null;
  toWalletId: string | null;
  amount: string;
  note: string | null;
  createdAt: string;
  // Present on the API response but only meaningful for grouping a single
  // customer-facing action's sub-legs (a credit wallet purchase's funding
  // transfer + ceiling draw-down, a reversal's restore legs, ...) back
  // together — see DashboardView's history clustering.
  idempotencyKey?: string;
  relatedTransactionId?: string | null;
  relatedPurchaseId?: string | null;
  completesPurchaseId?: string | null;
}

// One purchase's worth of an installment's billing period, resolved back to
// the merchant it was spent at (see backend InstallmentsService
// .getSpendBreakdown) — "where did the customer's money go" for that
// installment's batch.
export interface InstallmentSpendDetail {
  purchaseId: string;
  merchantName: string;
  amount: string;
  spentAt: string;
}

export interface Installment {
  id: string;
  walletId: string;
  // The credit purchase this installment's plan was generated from (see
  // backend InstallmentsService.createForPurchase) — null on rows from the
  // older monthly-billing model.
  purchaseTransactionId: string | null;
  // The purchase date for a per-purchase plan; for older rows, the
  // one-month window their batch was summed over.
  periodStart: string;
  periodEnd: string;
  sequenceNumber: number;
  amount: string;
  principalAmount: string;
  feeAmount: string;
  penaltyApplied: boolean;
  penaltyDaysApplied: number;
  dueDate: string;
  deadlineDate: string;
  dueCheckedAt: string | null;
  status: 'PENDING' | 'OVERDUE' | 'PAID' | 'CANCELED';
  paidAt: string | null;
  paymentTransactionId: string | null;
  createdAt: string;
  spendBreakdown: InstallmentSpendDetail[];
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
  limit: number;
  offset: number;
}

const TRANSACTIONS_PAGE_SIZE = 25;
// ActivityChart's widest view is the last 8 weeks.
const ACTIVITY_WINDOW_MS = 8 * 7 * 24 * 60 * 60 * 1000;

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    wallets: [] as Wallet[],
    walletTypes: [] as WalletType[],
    // The history pages loaded so far (newest first), the server-side total
    // they're drawn from, and a separate time-bounded slice for the activity
    // chart, which needs every row in its window regardless of paging.
    transactions: [] as Transaction[],
    transactionsTotal: 0,
    recentTransactions: [] as Transaction[],
    loadingMoreTransactions: false,
    installments: [] as Installment[],
  }),
  getters: {
    hasMoreTransactions: (state) => state.transactions.length < state.transactionsTotal,
  },
  actions: {
    async fetchWallets() {
      this.wallets = await apiRequest<Wallet[]>('/wallets');
    },
    async fetchWalletTypes() {
      this.walletTypes = await apiRequest<WalletType[]>('/wallet-types');
    },
    // Reloads history from the first page (and the chart's window). Called on
    // mount and after any action that posts new ledger rows.
    async fetchTransactions() {
      const since = new Date(Date.now() - ACTIVITY_WINDOW_MS).toISOString();
      const [page, recent] = await Promise.all([
        apiRequest<TransactionPage>(`/transactions?limit=${TRANSACTIONS_PAGE_SIZE}&offset=0`),
        apiRequest<Transaction[]>(`/transactions?since=${encodeURIComponent(since)}`),
      ]);
      this.transactions = page.items;
      this.transactionsTotal = page.total;
      this.recentTransactions = recent;
    },
    // Appends the next page. Rows posted since the first page shift older
    // rows down, so the next offset can overlap what's already loaded —
    // duplicates are dropped by id rather than shown twice.
    async loadMoreTransactions() {
      if (this.loadingMoreTransactions || !this.hasMoreTransactions) return;
      this.loadingMoreTransactions = true;
      try {
        const page = await apiRequest<TransactionPage>(
          `/transactions?limit=${TRANSACTIONS_PAGE_SIZE}&offset=${this.transactions.length}`,
        );
        const seen = new Set(this.transactions.map((tx) => tx.id));
        this.transactions = [...this.transactions, ...page.items.filter((tx) => !seen.has(tx.id))];
        this.transactionsTotal = page.total;
      } finally {
        this.loadingMoreTransactions = false;
      }
    },
    async fetchInstallments() {
      this.installments = await apiRequest<Installment[]>('/installments');
    },
    // One credit wallet's own installment schedule — the dedicated
    // per-wallet view linked from that wallet's card, as opposed to
    // fetchInstallments() which mixes every credit wallet together.
    async fetchInstallmentsForWallet(walletId: string) {
      return apiRequest<Installment[]>(`/installments/wallet/${walletId}`);
    },
    async payInstallment(installmentId: string) {
      return apiRequest<{ transactionId: string; redirectUrl: string; expiresAt: string }>(
        `/transactions/installments/${installmentId}/pay`,
        {
          method: 'POST',
          idempotent: true,
        },
      );
    },
    async createWallet(walletTypeId: string, options?: WalletOptionsInput) {
      await apiRequest('/wallets', {
        method: 'POST',
        body: { walletTypeId, ...options },
      });
      await this.fetchWallets();
    },
    async updateWallet(walletId: string, options: WalletOptionsInput) {
      await apiRequest(`/wallets/${walletId}`, {
        method: 'PATCH',
        body: options,
      });
      await this.fetchWallets();
    },
    // Saves the customer's own arrangement of their wallets; the server
    // returns the list in its new order.
    async reorderWallets(walletIds: string[]) {
      this.wallets = await apiRequest<Wallet[]>('/wallets/order', {
        method: 'PUT',
        body: { walletIds },
      });
    },
    async setDefaultWallet(walletId: string) {
      await apiRequest(`/wallets/${walletId}/default`, { method: 'POST' });
      await this.fetchWallets();
    },
    async closeWallet(walletId: string) {
      await apiRequest(`/wallets/${walletId}`, { method: 'DELETE' });
      await this.fetchWallets();
    },
    async grantCredit(input: GrantCreditInput) {
      await apiRequest('/wallets/credit-grant', {
        method: 'POST',
        body: input,
        idempotent: true,
      });
      await this.fetchWallets();
    },
    async deposit(walletId: string, amount: number) {
      return apiRequest<{ transactionId: string; redirectUrl: string; expiresAt: string }>(
        '/transactions/deposit',
        {
          method: 'POST',
          body: { walletId, amount },
          idempotent: true,
        },
      );
    },
    async withdraw(
      walletId: string,
      amount: number,
      railType: SettlementRailType,
      destinationIban: string,
    ) {
      await apiRequest('/transactions/withdraw', {
        method: 'POST',
        body: { walletId, amount, railType, destinationIban },
        idempotent: true,
      });
      await Promise.all([this.fetchWallets(), this.fetchTransactions()]);
    },
    async transfer(fromWalletId: string, toEmail: string, amount: number) {
      await apiRequest('/transactions/transfer', {
        method: 'POST',
        body: { fromWalletId, toEmail, amount },
        idempotent: true,
      });
      await Promise.all([this.fetchWallets(), this.fetchTransactions()]);
    },
    // `merchant` is the merchant's mobile number or terminal number.
    async initiatePurchase(fromWalletId: string, merchant: string, amount: number) {
      return apiRequest<{ transactionId: string; redirectUrl: string; expiresAt: string }>(
        '/transactions/purchase/initiate',
        {
          method: 'POST',
          body: { fromWalletId, merchant: merchant.trim(), amount },
          idempotent: true,
        },
      );
    },
    async createCharge(
      amount: number,
      currencyCode: string,
      language: string,
      settlementSplits?: SettlementSplitInput[],
    ) {
      return apiRequest<{ transactionId: string; redirectUrl: string; expiresAt: string }>(
        '/transactions/purchase/charge',
        {
          method: 'POST',
          body: { amount, currencyCode, language, settlementSplits },
          idempotent: true,
        },
      );
    },
  },
});
