import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  envDir: '../..',
  server: {
    port: parseInt(process.env['FRONTEND_PORT'] ?? '4321', 10),
    proxy: {
      '/api': process.env['PROXY_TARGET'] ?? 'http://localhost:8788',
    },
  },
})
