import { ADDRESSES, RPC_URL } from '../config.ts'

const SELECTORS = {
  price: '0xa035b1fe',
  twap: '0x10aa790e',
  nav: '0x1521843e',
  index: '0x2986c0e5',
  reserves: '0x0902f1ac',
  checkpoint: '0x1667bcec',
  minWindow: '0xbb996e95',
  maxWindow: '0xcb2701d9',
  token0: '0x0dfe1681',
  token1: '0xd21220a7',
  market: '0x5c60e39a',
} as const

type RpcResponse = {
  id?: number
  result?: unknown
  error?: { message?: string; data?: string }
}

export type ChainRead = {
  blockNumber: number | null
  blockTimestamp: number | null
  morphoPrice: bigint | null
  priceReverted: boolean
  twapWad: bigint | null
  twapReverted: boolean
  navWad: bigint | null
  index: bigint | null
  reserve0: bigint | null
  reserve1: bigint | null
  token0: string | null
  token1: string | null
  checkpointAt: number | null
  twapMinSec: number | null
  twapMaxSec: number | null
  supplyRaw: bigint | null
  borrowRaw: bigint | null
  chainLastUpdate: number | null
  errors: string[]
}

/** The desk's chain reads, one batch. rpc.mjs lets exactly these through /api/rpc. */
export function chainCalls(): Array<{ method: string; params: unknown[] }> {
  const marketData = `${SELECTORS.market}${ADDRESSES.marketId.slice(2)}`
  return [
    { method: 'eth_blockNumber', params: [] },
    { method: 'eth_getBlockByNumber', params: ['latest', false] },
    { method: 'eth_call', params: [{ to: ADDRESSES.oracle, data: SELECTORS.price }, 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESSES.pairOracle, data: SELECTORS.twap }, 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESSES.treasury, data: SELECTORS.nav }, 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESSES.sNet, data: SELECTORS.index }, 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESSES.pair, data: SELECTORS.reserves }, 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESSES.pair, data: SELECTORS.token0 }, 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESSES.pair, data: SELECTORS.token1 }, 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESSES.pairOracle, data: SELECTORS.checkpoint }, 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESSES.pairOracle, data: SELECTORS.minWindow }, 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESSES.pairOracle, data: SELECTORS.maxWindow }, 'latest'] },
    { method: 'eth_call', params: [{ to: ADDRESSES.morpho, data: marketData }, 'latest'] },
  ]
}

export async function readChain(signal?: AbortSignal): Promise<ChainRead> {
  const responses = await rpcBatch(chainCalls(), signal)
  const errors: string[] = []

  const blockHex = asHex(responses[0], 'block', errors)
  let blockTimestamp: number | null = null
  const blockBody = responses[1]?.result
  if (responses[1]?.error) {
    errors.push(`block timestamp: ${responses[1].error.message ?? 'reverted'}`)
  } else if (isRecord(blockBody) && typeof blockBody.timestamp === 'string') {
    blockTimestamp = Number.parseInt(blockBody.timestamp, 16)
  } else {
    errors.push('block timestamp: unreadable')
  }

  const price = uintOrNull(responses[2], 'oracle price', errors, true)
  const twap = uintOrNull(responses[3], 'TWAP', errors, true)
  const nav = uintOrNull(responses[4], 'NAV', errors, false)
  const index = uintOrNull(responses[5], 'dividend index', errors, false)
  const reserves = responses[6]
  let reserve0: bigint | null = null
  let reserve1: bigint | null = null
  if (reserves?.error || typeof reserves?.result !== 'string' || reserves.result === '0x') {
    errors.push(`reserves: ${reserves?.error?.message ?? 'empty'}`)
  } else {
    const words = wordsOf(reserves.result)
    reserve0 = words[0] ?? null
    reserve1 = words[1] ?? null
  }

  const market = responses[12]
  let supplyRaw: bigint | null = null
  let borrowRaw: bigint | null = null
  let chainLastUpdate: number | null = null
  if (market?.error || typeof market?.result !== 'string' || market.result === '0x') {
    errors.push(`Morpho market(): ${market?.error?.message ?? 'empty'}`)
  } else {
    const words = wordsOf(market.result)
    supplyRaw = words[0] ?? null
    borrowRaw = words[2] ?? null
    chainLastUpdate = words[4] === undefined ? null : Number(words[4])
  }

  return {
    blockNumber: blockHex ? Number.parseInt(blockHex, 16) : null,
    blockTimestamp,
    morphoPrice: price.value,
    priceReverted: price.reverted,
    twapWad: twap.value,
    twapReverted: twap.reverted,
    navWad: nav.value,
    index: index.value,
    reserve0,
    reserve1,
    token0: addressOrNull(responses[7]),
    token1: addressOrNull(responses[8]),
    checkpointAt: numberOrNull(responses[9]),
    twapMinSec: numberOrNull(responses[10]),
    twapMaxSec: numberOrNull(responses[11]),
    supplyRaw,
    borrowRaw,
    chainLastUpdate,
    errors,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asHex(response: RpcResponse | undefined, label: string, errors: string[]): string | null {
  if (!response) {
    errors.push(`${label}: missing`)
    return null
  }
  if (response.error || typeof response.result !== 'string') {
    errors.push(`${label}: ${response.error?.message ?? 'empty'}`)
    return null
  }
  return response.result
}

function uintOrNull(
  response: RpcResponse | undefined,
  label: string,
  errors: string[],
  trackRevert: boolean,
): { value: bigint | null; reverted: boolean } {
  if (!response) {
    errors.push(`${label}: missing`)
    return { value: null, reverted: trackRevert }
  }
  if (response.error || typeof response.result !== 'string' || response.result === '0x') {
    if (trackRevert) return { value: null, reverted: true }
    errors.push(`${label}: ${response.error?.message ?? 'empty'}`)
    return { value: null, reverted: false }
  }
  return { value: BigInt(response.result), reverted: false }
}

function addressOrNull(response: RpcResponse | undefined): string | null {
  if (response?.error || typeof response?.result !== 'string') return null
  const hex = response.result.replace(/^0x/, '').padStart(64, '0').slice(-40)
  return `0x${hex}`
}

function numberOrNull(response: RpcResponse | undefined): number | null {
  if (response?.error || typeof response?.result !== 'string' || response.result === '0x') return null
  return Number(BigInt(response.result))
}

function wordsOf(hex: string): bigint[] {
  const body = hex.replace(/^0x/, '')
  const words: bigint[] = []
  for (let i = 0; i < body.length; i += 64) {
    const slice = body.slice(i, i + 64)
    if (slice.length === 0) break
    words.push(BigInt(`0x${slice}`))
  }
  return words
}

async function rpcBatch(calls: Array<{ method: string; params: unknown[] }>, signal?: AbortSignal): Promise<RpcResponse[]> {
  const body = calls.map((call, id) => ({ jsonrpc: '2.0', id, method: call.method, params: call.params }))
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) {
    throw new Error(`Robinhood RPC HTTP ${response.status}`)
  }
  const json = (await response.json()) as RpcResponse[] | RpcResponse
  if (!Array.isArray(json)) {
    throw new Error(json.error?.message ?? 'Robinhood RPC rejected the batch')
  }
  const byId = new Map<number, RpcResponse>()
  for (const item of json) {
    if (typeof item.id === 'number') byId.set(item.id, item)
  }
  return calls.map((_, id) => byId.get(id) ?? { error: { message: 'missing batch item' } })
}
