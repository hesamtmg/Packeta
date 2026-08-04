import { createApp } from 'vue';
import { createPinia } from 'pinia';
// The combined per-weight files (400.css etc.) bundle the Arabic-script
// subset too, but its declared unicode-range claims U+FB50-FDFF — which
// includes the Rial sign we want rendered by Noto Nastaliq Urdu instead (see
// the @font-face block in admin-theme.css). Importing latin/latin-ext only
// here and declaring our own corrected Arabic-subset faces there keeps every
// codepoint claimed by exactly one face, so the right glyph shows up
// regardless of how reliably a given browser falls back within a family
// when a declared range's face turns out to be missing a glyph.
import '@fontsource/vazirmatn/latin-400.css';
import '@fontsource/vazirmatn/latin-500.css';
import '@fontsource/vazirmatn/latin-600.css';
import '@fontsource/vazirmatn/latin-700.css';
import '@fontsource/vazirmatn/latin-ext-400.css';
import '@fontsource/vazirmatn/latin-ext-500.css';
import '@fontsource/vazirmatn/latin-ext-600.css';
import '@fontsource/vazirmatn/latin-ext-700.css';
import App from './App.vue';
import router from './router';
import { i18n } from './i18n';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(i18n);
app.mount('#app');
