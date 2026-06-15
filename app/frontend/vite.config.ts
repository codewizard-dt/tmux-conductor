import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  envDir: '../..',
  server: {
    port: parseInt(process.env['FRONTEND_PORT'] ?? '4321', 10),
    proxy: {
      // app/api routes (auth + invite-codes) go to the app/api service; everything
      // else under /api is conductor data served by the host-server. More-specific
      // keys must precede the catch-all '/api' (Vite matches the first prefix).
      '/api/auth': process.env['AUTH_PROXY_TARGET'] ?? `http://localhost:${process.env['API_PORT'] ?? '8080'}`,
      '/api/invite-codes': process.env['AUTH_PROXY_TARGET'] ?? `http://localhost:${process.env['API_PORT'] ?? '8080'}`,
      '/api/admin/invite-codes': process.env['AUTH_PROXY_TARGET'] ?? `http://localhost:${process.env['API_PORT'] ?? '8080'}`,
      '/api/devices': process.env['AUTH_PROXY_TARGET'] ?? `http://localhost:${process.env['API_PORT'] ?? '8080'}`,
      '/api/pair': process.env['AUTH_PROXY_TARGET'] ?? `http://localhost:${process.env['API_PORT'] ?? '8080'}`,
      '/api': process.env['PROXY_TARGET'] ?? `http://localhost:${process.env['BACKEND_PORT'] ?? '8788'}`,
    },
  },
})
