import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // `turbo run test` runs every package's suite in parallel, so the API
  // integration suite (many forked workers hitting live Upstash/Supabase) can
  // saturate the machine while these run. The first Intl.DateTimeFormat call
  // with a named timezone triggers a one-time ICU timezone-data load that,
  // under that CPU contention, can blow past Vitest's 5s default — even though
  // the functions themselves are trivial. Give cold runs realistic headroom.
  test: {
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (cookies) {
              proxyRes.headers['set-cookie'] = cookies.map((cookie) =>
                cookie.replace(/\bPath=\/auth\b/i, 'Path=/api/auth'),
              );
            }
          });
        },
      },
    },
  },
});
