/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string
  readonly VITE_MORPHO_GRAPHQL?: string
  readonly VITE_POLL_SECONDS?: string
  readonly VITE_ZEROX_API_KEY?: string
}

/** Inlined from ZEROX_API_KEY or VITE_ZEROX_API_KEY at build time. Empty when unset. */
declare const __ZEROX_API_KEY__: string | undefined

interface ImportMeta {
  readonly env: ImportMetaEnv
}
