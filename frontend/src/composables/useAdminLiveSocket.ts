import { onMounted, onUnmounted, ref, type Ref } from 'vue';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from '../api/client';
import { useAuthStore } from '../stores/auth';

const MAX_EVENTS = 200;

export interface LiveTransaction {
  id: string;
  type: string;
  status: string;
  action: string;
  fromWalletId: string | null;
  toWalletId: string | null;
  amount: string;
  createdAt: string;
}

export interface LiveTransactionStatusChange {
  id: string;
  type: string;
  status: string;
  reason?: string;
  updatedAt: string;
}

export interface LiveWalletBalanceChange {
  walletId: string;
  delta: string;
  transactionId: string;
  description: string;
  at: string;
}

export interface LiveGlPosting {
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

export interface LiveSettlementActivity {
  walletId: string;
  railType?: string | null;
  transactionIds: string[];
  currentTime: string;
  at: string;
}

export interface LiveInstallmentActivity {
  kind: 'generated' | 'overdue_penalty';
  count: number;
  installmentIds?: string[];
  at: string;
}

// View-scoped WebSocket connection to the admin realtime feed
// (backend/src/realtime/realtime.gateway.ts, namespace /admin-live) —
// instantiated once inside AdminLiveActivityView and torn down on unmount,
// rather than a Pinia store, so the socket doesn't stay open once the admin
// navigates away. Reconnection is handled entirely by socket.io-client's
// own defaults; an explicit "unauthorized" disconnect (bad/expired token,
// or the account losing the liveActivity grant) stops retrying instead of
// hammering the server with a token that will never work.
export function useAdminLiveSocket() {
  const connected = ref(false);
  const unauthorized = ref(false);

  const transactions = ref<LiveTransaction[]>([]);
  const statusChanges = ref<LiveTransactionStatusChange[]>([]);
  const walletChanges = ref<LiveWalletBalanceChange[]>([]);
  const glPostings = ref<LiveGlPosting[]>([]);
  const settlementActivity = ref<LiveSettlementActivity[]>([]);
  const installmentActivity = ref<LiveInstallmentActivity[]>([]);

  let socket: Socket | null = null;

  function pushCapped<T>(list: Ref<T[]>, item: T) {
    list.value = [item, ...list.value].slice(0, MAX_EVENTS);
  }

  function connect() {
    if (socket) return;
    const auth = useAuthStore();
    socket = io(`${API_URL}/admin-live`, {
      auth: { token: auth.accessToken },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    socket.on('connect', () => {
      connected.value = true;
      unauthorized.value = false;
    });
    socket.on('disconnect', (reason) => {
      connected.value = false;
      if (reason === 'io server disconnect') {
        // The gateway rejected/dropped us (bad token, or no longer
        // authorized) — don't let socket.io auto-reconnect with the same
        // credentials forever.
        unauthorized.value = true;
        socket?.disconnect();
      }
    });

    socket.on('transaction.created', (event: LiveTransaction) =>
      pushCapped(transactions, event),
    );
    socket.on('transaction.status_changed', (event: LiveTransactionStatusChange) =>
      pushCapped(statusChanges, event),
    );
    socket.on('wallet.balance_changed', (event: LiveWalletBalanceChange) =>
      pushCapped(walletChanges, event),
    );
    socket.on('gl.posting_created', (event: LiveGlPosting) =>
      pushCapped(glPostings, event),
    );
    socket.on('settlement.activity', (event: LiveSettlementActivity) =>
      pushCapped(settlementActivity, event),
    );
    socket.on('installment.activity', (event: LiveInstallmentActivity) =>
      pushCapped(installmentActivity, event),
    );
  }

  function disconnect() {
    socket?.disconnect();
    socket = null;
    connected.value = false;
  }

  onMounted(connect);
  onUnmounted(disconnect);

  return {
    connected,
    unauthorized,
    transactions,
    statusChanges,
    walletChanges,
    glPostings,
    settlementActivity,
    installmentActivity,
    connect,
    disconnect,
  };
}
