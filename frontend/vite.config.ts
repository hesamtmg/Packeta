import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
  },
  preview: {
    port: 5173,
    // vite preview's Host-header allowlist (DNS-rebinding protection) has
    // no purpose here: this container publishes no host port and is only
    // ever reached through nginx over the internal compose network, which
    // is the actual trust boundary — nginx forwards whatever Host header
    // the client sent (e.g. www.packeta.ir with no DNS record of its own,
    // routed here as nginx's default vhost), and vite's own check has no
    // way to know every hostname that might legitimately land here.
    allowedHosts: true,
  },
});
