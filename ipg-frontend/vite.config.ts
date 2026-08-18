import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
  },
  preview: {
    port: 5174,
    // See frontend/vite.config.ts for why this is safe: this container is
    // only reachable through nginx over the internal compose network.
    allowedHosts: true,
  },
});
