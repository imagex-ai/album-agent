import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Older source installations can update before installing newly added packages.
// Keep their build usable without reintroducing esbuild's Windows cleanup issue.
const require = createRequire(import.meta.url);
let hasTerser = true;
let hasSentry = true;
try {
  require.resolve('terser');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error;
  hasTerser = false;
}
try {
  require.resolve('@sentry/browser');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw error;
  hasSentry = false;
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: { __IMAGEX_SENTRY_SDK_AVAILABLE__: JSON.stringify(hasSentry) },
  resolve: {
    alias: hasSentry ? {} : {
      '@sentry/browser': fileURLToPath(new URL('./src/services/sentryUnavailable.ts', import.meta.url)),
    },
  },
  build: {
    target: 'esnext',
    // Terser keeps the mobile payload small without esbuild's large-output
    // temporary-file cleanup, which can fail with Access denied on Windows.
    // Keep the existing explicit opt-out for troubleshooting build environments.
    minify: process.env.IMAGEX_UNMINIFIED_BUILD === 'true' || !hasTerser ? false : 'terser',
  },
  server: {
    port: 5174,
    open: false,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8100',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});
