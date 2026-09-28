/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string
  readonly VITE_MORPHO_GRAPHQL?: string
  readonly VITE_POLL_SECONDS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
