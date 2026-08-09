import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

// Separate from vite.config.ts on purpose — the normal SPA dev server/build
// (npm run dev / npm run build) stays completely untouched by this file.
// Run via `npm run build:widget` (see package.json), which invokes this
// config twice (WIDGET_TARGET=wallet, then WIDGET_TARGET=pay) since Vite's
// lib mode doesn't support multiple entries for iife/umd output formats.
const ENTRIES = {
  wallet: { entry: 'src/widget-entries/wallet.ts', fileName: 'wallet-widget' },
  pay: { entry: 'src/widget-entries/pay.ts', fileName: 'pay-widget' },
} as const;

const targetKey = (process.env.WIDGET_TARGET ?? 'wallet') as keyof typeof ENTRIES;
const target = ENTRIES[targetKey];
if (!target) {
  throw new Error(`vite.widget.config.ts: unknown WIDGET_TARGET "${process.env.WIDGET_TARGET}"`);
}

export default defineConfig({
  // Vue's runtime includes dev-only warning paths gated on
  // process.env.NODE_ENV — normal `vite build` replaces this
  // automatically, but this standalone iife lib build needs it spelled
  // out explicitly or the literal `process.env.NODE_ENV` reference ships
  // as-is and throws ReferenceError in a browser (no Node `process` global).
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [
    vue({
      // Only these two panel components compile in "custom element" mode
      // (their CSS is delivered via the component's own .styles array
      // instead of being auto-injected into document.head) — scoped to
      // this build only. The normal SPA build (vite.config.ts, its own
      // vue() plugin instance) renders these same files unchanged through
      // the routed WidgetView.vue/PayWidgetView.vue wrappers.
      customElement: [
        /src[\\/]components[\\/]WidgetAccountPanel\.vue$/,
        /src[\\/]components[\\/]WidgetPayPanel\.vue$/,
      ],
    }),
  ],
  build: {
    outDir: '../sdk/js',
    // sdk/js/ also holds packeta.js, server-example.js, README.md,
    // package-lock.json, node_modules/ — emptyOutDir defaults to true and
    // would delete all of that on the first widget build.
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, target.entry),
      formats: ['iife'],
      fileName: () => `${target.fileName}.js`,
      name: `Packeta${target.fileName === 'wallet-widget' ? 'Wallet' : 'Pay'}WidgetBundle`,
    },
  },
});
