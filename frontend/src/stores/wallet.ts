import { defineStore } from 'pinia';
import { apiRequest } from '../api/client';

export interface WalletType {
  code: string;
  name: string;
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
    async createWallet(walletTypeCode: string) {
      await apiRequest('/wallets', {
        method: 'POST',
        body: { walletTypeCode },
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
