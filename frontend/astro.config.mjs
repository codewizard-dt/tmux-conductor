// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'

export default defineConfig({
  integrations: [react()],
  server: { port: parseInt(process.env['FRONTEND_PORT'] ?? '4321', 10) },
  vite: {
    envDir: '..',
    server: {
      proxy: {
        '/api': 'http://localhost:8788',
      },
    },
  },
})
