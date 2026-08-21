import { defineConfig, mergeConfig } from 'vite'
import { defineConfig as defineVitestConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const viteConfig = defineConfig({
  plugins: [react()],
  envDir: '..',
  server: {
    port: parseInt(process.env['FRONTEND_PORT'] ?? '4321', 10),
    proxy: {
      // All /api/* requests are conductor data served by the host-server.
      '/api': {
        target: process.env['PROXY_TARGET'] ?? `http://localhost:${process.env['BACKEND_PORT'] ?? '8788'}`,
        ws: true,
      },
    },
  },
})

export default mergeConfig(
  viteConfig,
  defineVitestConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./vitest.setup.ts'],
    },
  }),
)
