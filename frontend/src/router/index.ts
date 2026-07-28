import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import LoginView from '../views/LoginView.vue';
import SignupView from '../views/SignupView.vue';
import DashboardView from '../views/DashboardView.vue';
import TransactionDetailView from '../views/TransactionDetailView.vue';
import AdminDashboardView from '../views/admin/AdminDashboardView.vue';
import AdminTransactionsView from '../views/admin/AdminTransactionsView.vue';
import AdminWalletsView from '../views/admin/AdminWalletsView.vue';
import AdminCustomersView from '../views/admin/AdminCustomersView.vue';
import AdminAdminsView from '../views/admin/AdminAdminsView.vue';
import AdminWalletTypesView from '../views/admin/AdminWalletTypesView.vue';
import AdminReportsView from '../views/admin/AdminReportsView.vue';

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
      path: '/transactions/:id',
      name: 'transaction-detail',
      component: TransactionDetailView,
      meta: { requiresAuth: true },
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
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/wallets',
      name: 'admin-wallets',
      component: AdminWalletsView,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/customers',
      name: 'admin-customers',
      component: AdminCustomersView,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/admins',
      name: 'admin-admins',
      component: AdminAdminsView,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/wallet-types',
      name: 'admin-wallet-types',
      component: AdminWalletTypesView,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/reports',
      name: 'admin-reports',
      component: AdminReportsView,
      meta: { requiresAuth: true, requiresAdmin: true },
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
  return true;
});

export default router;
