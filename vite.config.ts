import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    proxy: { '/api': 'http://localhost:4100', '/login': 'http://localhost:4100' },
  },
  build: { target: 'es2020', chunkSizeWarningLimit: 2000 },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
