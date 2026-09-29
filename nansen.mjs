// Server-side Nansen snapshot for NET on Robinhood Chain.
// The key stays on the server. One refresh per TTL, only when someone asks.

const BASE = 'https://api.nansen.ai/api/v1'
const CHAIN = 'robinhood'
const NET = '0xca9c78dd337a67f6e0077f65f5e9218719d30edf'
const WSNET = '0x63c12667638f2ae6fc6ae09b43d98ec84a8586ea'

const ttlMinutes = (() => {
  const value = Number(process.env.NANSEN_TTL_MINUTES ?? '60')
  return Number.isFinite(value) ? Math.min(Math.max(value, 10), 720) : 60
})()

let cached = null
let inflight = null
let failedAt = 0
const RETRY_MS = 5 * 60_000

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const str = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const rows = (payload) => (Array.isArray(payload?.data) ? payload.data.filter((row) => row && typeof row === 'object') : [])

async function post(path, body, key) {
  const response = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  // Status only. Nansen error bodies can echo request details.
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`)
  return response.json()
}

function range(days) {
  const now = Date.now()
  return { from: new Date(now - days * 86_400_000).toISOString(), to: new Date(now).toISOString() }
}

const holder = (row) => ({
  address: str(row.address),
  label: str(row.address_label),
  amount: num(row.token_amount),
  change7d: num(row.balance_change_7d),
  change30d: num(row.balance_change_30d),
  valueUsd: num(row.value_usd),
})

const mover = (row) => ({
  address: str(row.address),
  label: str(row.address_label),
  boughtUsd: num(row.bought_volume_usd) ?? 0,
  soldUsd: num(row.sold_volume_usd) ?? 0,
  boughtNet: num(row.bought_token_volume) ?? 0,
  soldNet: num(row.sold_token_volume) ?? 0,
})

const trade = (row) => ({
  address: str(row.trader_address),
  label: str(row.trader_address_label),
  action: row.action === 'BUY' ? 'buy' : row.action === 'SELL' ? 'sell' : null,
  amount: num(row.token_amount),
  valueUsd: num(row.estimated_value_usd),
  at: str(row.block_timestamp),
  tx: str(row.transaction_hash),
})

const flow = (payload) => {
  const row = rows(payload)[0]
  if (!row) return null
  const pick = (prefix) => ({ netUsd: num(row[`${prefix}_net_flow_usd`]), wallets: num(row[`${prefix}_wallet_count`]) })
  return {
    smart: pick('smart_trader'),
    publicFigure: pick('public_figure'),
    topPnl: pick('top_pnl'),
    whale: pick('whale'),
    exchange: pick('exchange'),
    fresh: pick('fresh_wallets'),
  }
}

const info = (payload) => {
  const data = payload?.data
  if (!data || typeof data !== 'object') return null
  const details = data.token_details ?? {}
  const spot = data.spot_metrics ?? {}
  return {
    holders: num(spot.total_holders),
    buyVolumeUsd: num(spot.buy_volume_usd),
    sellVolumeUsd: num(spot.sell_volume_usd),
    buys: num(spot.total_buys),
    sells: num(spot.total_sells),
    uniqueBuyers: num(spot.unique_buyers),
    uniqueSellers: num(spot.unique_sellers),
    liquidityUsd: num(spot.liquidity_usd),
    totalSupply: num(details.total_supply),
  }
}

async function build(key) {
  const week = range(7)
  const jobs = {
    info: ['tgm/token-information', { chain: CHAIN, token_address: NET, timeframe: '7d' }, info],
    flow1d: ['tgm/flow-intelligence', { chain: CHAIN, token_address: NET, timeframe: '1d' }, flow],
    flow7d: ['tgm/flow-intelligence', { chain: CHAIN, token_address: NET, timeframe: '7d' }, flow],
    buyers: ['tgm/who-bought-sold', { chain: CHAIN, token_address: NET, buy_or_sell: 'BUY', date: week, pagination: { page: 1, per_page: 100 } }, (p) => rows(p).map(mover)],
    sellers: ['tgm/who-bought-sold', { chain: CHAIN, token_address: NET, buy_or_sell: 'SELL', date: week, pagination: { page: 1, per_page: 100 } }, (p) => rows(p).map(mover)],
    smartTrades: ['tgm/dex-trades', { chain: CHAIN, token_address: NET, only_smart_money: true, date: week, pagination: { page: 1, per_page: 200 } }, (p) => rows(p).map(trade)],
    smartHolders: ['tgm/holders', { chain: CHAIN, token_address: NET, label_type: 'smart_money', pagination: { page: 1, per_page: 100 } }, (p) => rows(p).map(holder)],
    holders: ['tgm/holders', { chain: CHAIN, token_address: NET, label_type: 'all_holders', pagination: { page: 1, per_page: 300 }, order_by: [{ field: 'token_amount', direction: 'DESC' }] }, (p) => rows(p).map(holder)],
    wsHolders: ['tgm/holders', { chain: CHAIN, token_address: WSNET, label_type: 'all_holders', pagination: { page: 1, per_page: 300 }, order_by: [{ field: 'token_amount', direction: 'DESC' }] }, (p) => rows(p).map(holder)],
  }
  const names = Object.keys(jobs)
  const settled = await Promise.allSettled(names.map((name) => post(jobs[name][0], jobs[name][1], key)))
  const body = { fetchedAt: Date.now(), ttlMinutes, stale: false, errors: [] }
  settled.forEach((result, i) => {
    const name = names[i]
    if (result.status === 'fulfilled') {
      body[name] = jobs[name][2](result.value)
    } else {
      body[name] = null
      body.errors.push(result.reason instanceof Error ? result.reason.message : `${name} failed`)
    }
  })
  if (body.errors.length === names.length) throw new Error(body.errors[0] ?? 'Nansen unavailable')
  return body
}

export async function nansenSnapshot() {
  const key = process.env.NANSEN_API_KEY?.trim()
  if (!key) return { status: 503, body: { error: 'NANSEN_API_KEY is not set on the server.' } }
  if (cached && Date.now() - cached.fetchedAt < ttlMinutes * 60_000) return { status: 200, body: cached }
  if (!inflight && Date.now() - failedAt < RETRY_MS) {
    return cached
      ? { status: 200, body: { ...cached, stale: true } }
      : { status: 502, body: { error: 'Nansen refresh failed. Retrying in a few minutes.' } }
  }
  inflight ??= build(key)
    .then((body) => {
      // Keep a section from the last good read when only that call failed.
      if (cached) for (const [name, value] of Object.entries(body)) if (value === null) body[name] = cached[name]
      cached = body
      return body
    })
    .catch((error) => {
      failedAt = Date.now()
      throw error
    })
    .finally(() => {
      inflight = null
    })
  try {
    return { status: 200, body: await inflight }
  } catch (error) {
    if (cached) return { status: 200, body: { ...cached, stale: true } }
    return { status: 502, body: { error: error instanceof Error ? error.message : 'Nansen unavailable' } }
  }
}

/** Node http handler shared by server.mjs and the Vite dev server. */
export async function handleNansen(_req, res) {
  const { status, body } = await nansenSnapshot()
  res.writeHead(status, {
    'cache-control': status === 200 ? 'public, max-age=300' : 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(body))
}
