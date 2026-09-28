function envString(key: keyof ImportMetaEnv, fallback: string): string {
  const value = import.meta.env[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

export const CHAIN_ID = 4663

export const LLTV = 625_000_000_000_000_000n
export const FOOTNOTE_LLTV = 385_000_000_000_000_000n

export const ADDRESSES = {
  morpho: '0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010',
  marketId: '0xaa586d26a6fe62d9c0f0948fede6e2130500ac7a655587447e2d4a37e6330589',
  footnoteMarketId: '0xf47c7a7a1ff6c7444e6fcfa20a71f439e4525f4f9640fe6ba5c080f6f2a9d33f',
  usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  wsNet: '0x63C12667638f2Ae6fC6ae09B43D98Ec84a8586eA',
  net: '0xCA9c78Dd337A67F6e0077F65F5E9218719d30eDf',
  pair: '0x59F95461E68e0c77605299791E1449f175165B54',
  oracle: '0xCDE9599059f8Ae6D6B9F33A0aF7877827ec75F16',
  irm: '0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1',
  pairOracle: '0x929631b33f4070d6f54477fba3fd27566567daca',
  treasury: '0x04822ea321a0dee6f40656172f29312104855d66',
  sNet: '0xb773ec2c326b7f98a5a83fc098825492f020a4c7',
} as const

export const LINKS = {
  morphoMarket:
    'https://app.morpho.org/robinhood-chain/variable/0xaa586d26a6fe62d9c0f0948fede6e2130500ac7a655587447e2d4a37e6330589/usdg-wsnet',
  netnet: 'https://app.netnet.capital/',
  lendingDocs: 'https://docs.netnet.capital/lending',
  creditDocs: 'https://docs.netnet.capital/credit',
  pairExplorer:
    'https://robinhoodchain.blockscout.com/address/0x59F95461E68e0c77605299791E1449f175165B54',
  oracleExplorer:
    'https://robinhoodchain.blockscout.com/address/0xCDE9599059f8Ae6D6B9F33A0aF7877827ec75F16',
} as const

export const RPC_URL = envString('VITE_RPC_URL', 'https://rpc.mainnet.chain.robinhood.com')
export const MORPHO_GRAPHQL = envString('VITE_MORPHO_GRAPHQL', 'https://api.morpho.org/graphql')

/** Public KyberSwap aggregator on Robinhood Chain. No key. */
export const KYBER_ROUTES = 'https://aggregator-api.kyberswap.com/robinhood/api/v1/routes'

/** 0x Swap API indicative price. Used only when ZEROX_API_KEY is set. */
export const ZEROX_PRICE = 'https://api.0x.org/swap/allowance-holder/price'

export const POLL_MS = (() => {
  const seconds = Number(envString('VITE_POLL_SECONDS', '45'))
  if (!Number.isFinite(seconds)) return 45_000
  return Math.round(Math.min(Math.max(seconds, 15), 300) * 1000)
})()
