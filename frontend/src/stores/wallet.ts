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
  allowPurchaseOut: boolean;
  allowPurchaseIn: boolean;
}

export interface SettlementAccount {
  id: string;
  iban: string;
  label: string | null;
  percent: string;
}

export interface Wallet {
  id: string;
  balance: string;
  autoWithdrawTimes: string[] | null;
  purchaseTimeoutSeconds: number | null;
  restrictedCounterparties: string[] | null;
  closedAt: string | null;
  terminalId: string | null;
  acceptorCode: string | null;
  settlementAccounts?: SettlementAccount[];
  walletType: WalletType;
  createdAt: string;
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

export const useWalletStore = defineStore('wallet', {
  state: () => ({
    wallets: [] as Wallet[],
    walletTypes: [] as WalletType[],
    transactions: [] as Transaction[],
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
    async createWallet(
      walletTypeId: string,
      options?: {
        autoWithdrawTimes?: string[];
        purchaseTimeoutSeconds?: number;
        settlementAccounts?: SettlementAccountInput[];
        restrictedCounterparties?: string[];
        terminalId?: string;
        acceptorCode?: string;
      },
    ) {
      await apiRequest('/wallets', {
        method: 'POST',
        body: { walletTypeId, ...options },
      });
      await this.fetchWallets();
    },
    async updateWallet(
      walletId: string,
      options: {
        autoWithdrawTimes?: string[];
        purchaseTimeoutSeconds?: number;
        settlementAccounts?: SettlementAccountInput[];
        restrictedCounterparties?: string[];
        terminalId?: string;
        acceptorCode?: string;
      },
    ) {
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
    async deposit(walletId: string, amount: number) {
      await apiRequest('/transactions/deposit', {
        method: 'POST',
        body: { walletId, amount },
        idempotent: true,
      });
      await Promise.all([this.fetchWallets(), this.fetchTransactions()]);
    },
    async withdraw(walletId: string, amount: number) {
      await apiRequest('/transactions/withdraw', {
        method: 'POST',
        body: { walletId, amount },
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
