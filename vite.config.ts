import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { handleBonds } from './bonds.mjs'
import { handleNansen } from './nansen.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const zeroxKey = env.ZEROX_API_KEY || env.VITE_ZEROX_API_KEY || ''
  // Server-only. nansen.mjs and bonds.mjs read process.env; never inline these into the bundle.
  for (const name of ['NANSEN_API_KEY', 'NANSEN_TTL_MINUTES', 'BONDS_TTL_SECONDS', 'BONDS_DEX_TTL_MINUTES', 'BONDS_CACHE_FILE', 'BONDS_BLOCK_RPCS']) {
    if (env[name]) process.env[name] ??= env[name]
  }
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
        server.middlewares.use('/api/bonds', (req, res) => void handleBonds(req, res))
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api/nansen', (req, res) => void handleNansen(req, res))
        server.middlewares.use('/api/bonds', (req, res) => void handleBonds(req, res))
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
