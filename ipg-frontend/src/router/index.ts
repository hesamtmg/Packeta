import { createRouter, createWebHistory } from 'vue-router';
import PayView from '../views/PayView.vue';
import WidgetView from '../views/WidgetView.vue';
import WidgetCallbackView from '../views/WidgetCallbackView.vue';
import PayWidgetView from '../views/PayWidgetView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/pay/:authority', name: 'pay', component: PayView },
    { path: '/widget/:token', name: 'widget', component: WidgetView },
    {
      path: '/widget/:token/callback/:transactionId',
      name: 'widget-callback',
      component: WidgetCallbackView,
    },
    { path: '/pay-widget/:authority', name: 'pay-widget', component: PayWidgetView },
  ],
});

export default router;
