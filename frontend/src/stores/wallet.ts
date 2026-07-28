import { defineStore } from 'pinia';
import { apiRequest } from '../api/client';

interface Wallet {
  id: string;
  balance: string;
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
    wallet: null as Wallet | null,
    transactions: [] as Transaction[],
  }),
  actions: {
    async fetchWallet() {
      this.wallet = await apiRequest<Wallet>('/wallets/me');
    },
    async fetchTransactions() {
      this.transactions = await apiRequest<Transaction[]>('/transactions');
    },
    async deposit(amount: number) {
      await apiRequest('/transactions/deposit', {
        method: 'POST',
        body: { amount },
        idempotent: true,
      });
      await Promise.all([this.fetchWallet(), this.fetchTransactions()]);
    },
    async withdraw(amount: number) {
      await apiRequest('/transactions/withdraw', {
        method: 'POST',
        body: { amount },
        idempotent: true,
      });
      await Promise.all([this.fetchWallet(), this.fetchTransactions()]);
    },
    async transfer(toEmail: string, amount: number) {
      await apiRequest('/transactions/transfer', {
        method: 'POST',
        body: { toEmail, amount },
        idempotent: true,
      });
      await Promise.all([this.fetchWallet(), this.fetchTransactions()]);
    },
  },
});
