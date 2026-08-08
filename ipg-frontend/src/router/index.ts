import { createRouter, createWebHistory } from 'vue-router';
import PayView from '../views/PayView.vue';
import WidgetView from '../views/WidgetView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/pay/:authority', name: 'pay', component: PayView },
    { path: '/widget/:token', name: 'widget', component: WidgetView },
  ],
});

export default router;
