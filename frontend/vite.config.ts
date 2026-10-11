import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Prefer TypeScript sources over stray emitted `.js` siblings under `src/`.
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
