import { defineStore } from 'pinia';
import { apiRequest } from '../api/client';
import type { CurrencyInfo } from '../utils/currency';

export interface WalletType {
  id: string;
  code: string;
  name: string;
  currency: CurrencyInfo;
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
  // Credit-line fields (repository/credit wallet feature) — shared billing
  // rules for every wallet of this type.
  installmentDate: number | null;
  paymentDeadlineDate: number | null;
  feePercent: string | null;
  penaltyPercentPerDay: string | null;
  unblockFee: string | null;
  installmentCount: number | null;
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
  balance: string;
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
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER' | 'ADJUSTMENT' | 'PURCHASE';
  fromWalletId: string | null;
  toWalletId: string | null;
  amount: string;
  createdAt: string;
}

export interface Installment {
  id: string;
  walletId: string;
  sequenceNumber: number;
  amount: string;
  principalAmount: string;
  penaltyApplied: boolean;
  penaltyDaysApplied: number;
  dueDate: string;
  deadlineDate: string;
  status: 'PENDING' | 'OVERDUE' | 'PAID';
  paidAt: string | null;
  paymentTransactionId: string | null;
  createdAt: string;
}

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    wallets: [] as Wallet[],
    walletTypes: [] as WalletType[],
    transactions: [] as Transaction[],
    installments: [] as Installment[],
  }),
  actions: {
    async fetchWallets() {
      this.wallets = await apiRequest<Wallet[]>('/wallets');
    },
    async fetchWalletTypes() {
      this.walletTypes = await apiRequest<WalletType[]>('/wallet-types');
    },
    async fetchTransactions() {
      this.transactions = await apiRequest<Transaction[]>('/transactions');
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
    async withdraw(walletId: string, amount: number, railType: SettlementRailType) {
      await apiRequest('/transactions/withdraw', {
        method: 'POST',
        body: { walletId, amount, railType },
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
    async initiatePurchase(fromWalletId: string, toEmail: string, amount: number) {
      return apiRequest<{ transactionId: string; redirectUrl: string; expiresAt: string }>(
        '/transactions/purchase/initiate',
        {
          method: 'POST',
          body: { fromWalletId, toEmail, amount },
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
