import { createRouter, createWebHistory } from 'vue-router';
import PayView from '../views/PayView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/pay/:authority', name: 'pay', component: PayView }],
});

export default router;
