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
}

export interface Wallet {
  id: string;
  balance: string;
  walletType: WalletType;
  createdAt: string;
}

interface Transaction {
  id: string;
  type: 'DEPOSIT' | 'WITHDRAW' | 'TRANSFER';
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
    async createWallet(walletTypeId: string) {
      await apiRequest('/wallets', {
        method: 'POST',
        body: { walletTypeId },
      });
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
  },
});
