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
      // App Platform strips the /api prefix before forwarding to the api service, so
      // the Vite proxy rewrites identically (strips /api) to keep dev parity with prod.
      '/api/admin/invite-codes': {
        target: process.env['AUTH_PROXY_TARGET'] ?? `http://localhost:${process.env['API_PORT'] ?? '8080'}`,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
      '/api/auth': {
        target: process.env['AUTH_PROXY_TARGET'] ?? `http://localhost:${process.env['API_PORT'] ?? '8080'}`,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
      '/api/invite-codes': {
        target: process.env['AUTH_PROXY_TARGET'] ?? `http://localhost:${process.env['API_PORT'] ?? '8080'}`,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
      '/api/devices': {
        target: process.env['AUTH_PROXY_TARGET'] ?? `http://localhost:${process.env['API_PORT'] ?? '8080'}`,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
      '/api/pair': {
        target: process.env['AUTH_PROXY_TARGET'] ?? `http://localhost:${process.env['API_PORT'] ?? '8080'}`,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
      '/api': process.env['PROXY_TARGET'] ?? `http://localhost:${process.env['BACKEND_PORT'] ?? '8788'}`,
    },
  },
})
