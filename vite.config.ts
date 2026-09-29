import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { handleNansen } from './nansen.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const zeroxKey = env.ZEROX_API_KEY || env.VITE_ZEROX_API_KEY || ''
  // Server-only. nansen.mjs reads process.env; never inline this into the bundle.
  if (env.NANSEN_API_KEY) process.env.NANSEN_API_KEY ??= env.NANSEN_API_KEY
  return {
  define: {
    __ZEROX_API_KEY__: JSON.stringify(zeroxKey),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'nansen-api',
      configureServer(server) {
        server.middlewares.use('/api/nansen', (req, res) => void handleNansen(req, res))
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api/nansen', (req, res) => void handleNansen(req, res))
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 4317,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4317,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  }
})
