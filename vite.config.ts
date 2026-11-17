import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { muyaUnicodeKeys } from './muya-unicode-keys';

export default defineConfig({
  plugins: [muyaUnicodeKeys(), react()],
  server: {
    port: 4000,
    proxy: { '/api': 'http://localhost:4100', '/login': 'http://localhost:4100' },
  },
  build: { target: 'es2020', chunkSizeWarningLimit: 2000 },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // Muya's build imports CSS/font/image assets; let Vite process it.
    server: { deps: { inline: [/@muyajs\/core/] } },
  },
});
