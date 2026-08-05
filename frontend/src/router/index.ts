import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import SignupView from '../views/SignupView.vue';
import DashboardView from '../views/DashboardView.vue';
import ProfileView from '../views/ProfileView.vue';
import TransactionDetailView from '../views/TransactionDetailView.vue';
import WalletDetailView from '../views/WalletDetailView.vue';
import WalletInstallmentsView from '../views/WalletInstallmentsView.vue';
import PurchaseCallbackView from '../views/PurchaseCallbackView.vue';
import AdminDashboardView from '../views/admin/AdminDashboardView.vue';
import AdminTransactionsView from '../views/admin/AdminTransactionsView.vue';
import AdminWalletsView from '../views/admin/AdminWalletsView.vue';
import AdminCustomersView from '../views/admin/AdminCustomersView.vue';
import AdminAdminsView from '../views/admin/AdminAdminsView.vue';
import AdminWalletTypesView from '../views/admin/AdminWalletTypesView.vue';
import AdminReportsView from '../views/admin/AdminReportsView.vue';
import AdminTransactionDetailView from '../views/admin/AdminTransactionDetailView.vue';
import AdminPurchaseView from '../views/admin/AdminPurchaseView.vue';
import AdminInstallmentsView from '../views/admin/AdminInstallmentsView.vue';
import AdminSchedulerLogsView from '../views/admin/AdminSchedulerLogsView.vue';
import AdminOffboardingView from '../views/admin/AdminOffboardingView.vue';
import AdminWalletDetailView from '../views/admin/AdminWalletDetailView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/signup', name: 'signup', component: SignupView },
    {
      path: '/',
      name: 'dashboard',
      component: DashboardView,
      meta: { requiresAuth: true },
    },
    {
      path: '/profile',
      name: 'profile',
      component: ProfileView,
      meta: { requiresAuth: true },
    },
    {
      path: '/transactions/:id',
      name: 'transaction-detail',
      component: TransactionDetailView,
      meta: { requiresAuth: true },
    },
    {
      path: '/wallets/:id',
      name: 'wallet-detail',
      component: WalletDetailView,
      meta: { requiresAuth: true },
    },
    {
      path: '/wallets/:walletId/installments',
      name: 'wallet-installments',
      component: WalletInstallmentsView,
      meta: { requiresAuth: true },
    },
    {
      // No requiresAuth: a merchant-initiated charge's customer never has a
      // Packeta session (they identify by phone+OTP at the IPG instead), so
      // this page must be reachable without one. verify/cancel are public
      // backend endpoints for the same reason.
      path: '/purchase/:id/callback',
      name: 'purchase-callback',
      component: PurchaseCallbackView,
    },
    {
      path: '/admin',
      name: 'admin-dashboard',
      component: AdminDashboardView,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/transactions',
      name: 'admin-transactions',
      component: AdminTransactionsView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'transactions' },
    },
    {
      path: '/admin/transactions/:id',
      name: 'admin-transaction-detail',
      component: AdminTransactionDetailView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'transactions' },
    },
    {
      path: '/admin/wallets',
      name: 'admin-wallets',
      component: AdminWalletsView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'wallets' },
    },
    {
      path: '/admin/wallets/:id',
      name: 'admin-wallet-detail',
      component: AdminWalletDetailView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'wallets' },
    },
    {
      path: '/admin/customers',
      name: 'admin-customers',
      component: AdminCustomersView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'customers' },
    },
    {
      path: '/admin/admins',
      name: 'admin-admins',
      component: AdminAdminsView,
      meta: {
        requiresAuth: true,
        requiresAdmin: true,
        // Any-of: "admins" to view panel users, "roles" to manage Roles —
        // see AdminLayout.vue's nav filter for the same pairing.
        requiresSection: ['admins', 'roles'],
      },
    },
    {
      path: '/admin/wallet-types',
      name: 'admin-wallet-types',
      component: AdminWalletTypesView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'walletTypes' },
    },
    {
      path: '/admin/reports',
      name: 'admin-reports',
      component: AdminReportsView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'reports' },
    },
    {
      path: '/admin/purchase',
      name: 'admin-purchase',
      component: AdminPurchaseView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'purchase' },
    },
    {
      path: '/admin/installments',
      name: 'admin-installments',
      component: AdminInstallmentsView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'installments' },
    },
    {
      path: '/admin/scheduler-logs',
      name: 'admin-scheduler-logs',
      component: AdminSchedulerLogsView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'schedulerLogs' },
    },
    {
      path: '/admin/offboarding',
      name: 'admin-offboarding',
      component: AdminOffboardingView,
      meta: { requiresAuth: true, requiresAdmin: true, requiresSection: 'offboarding' },
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login' };
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) {
    return { name: 'dashboard' };
  }
  const requiredSection = to.meta.requiresSection as string | string[] | undefined;
  if (requiredSection) {
    const required = Array.isArray(requiredSection) ? requiredSection : [requiredSection];
    if (!required.some((section) => auth.hasSection(section))) {
      return { name: 'admin-dashboard' };
    }
  }
  return true;
});

export default router;
