import { createApp } from 'vue';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/800.css';
import App from './App.vue';
import router from './router';
import { i18n } from './i18n';

const app = createApp(App);
app.use(router);
app.use(i18n);
app.mount('#app');
