// Server-side NetNet bond index for Robinhood Chain.
// Reads BondCreated logs, NET supply, sNET rebases, buyer holdings, and Nansen labels.
// Refreshes only when someone asks. Keeps the last good state in memory and on disk.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { gzipSync } from 'node:zlib'

const RPC = 'https://rpc.mainnet.chain.robinhood.com'
const NANSEN = 'https://api.nansen.ai/api/v1/tgm/transfers'
const DEPOSITORY = '0xff32a969a0c567129eecd926d04657728e1980c1'
const NET = '0xca9c78dd337a67f6e0077f65f5e9218719d30edf'
const SNET = '0xb773ec2c326b7f98a5a83fc098825492f020a4c7'
const WSNET = '0x63c12667638f2ae6fc6ae09b43d98ec84a8586ea'
const PAIR_ORACLE = '0x929631b33f4070d6f54477fba3fd27566567daca'
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11' // canonical Multicall3

const BOND_TOPIC = '0xd52c75b244055af9364c0a5dc0da7868f6ae104012f245ad2702031af04d9b8e'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const REBASE_TOPIC = '0x6012dbce857565c4a40974aa5de8373a761fc429077ef0c8c8611d1e20d63fb2'
const ZERO = `0x${'0'.repeat(64)}`
const SEL = {
  startTime: '0x78e97925',
  payoutInEpoch: '0xb1554951',
  bondPrice: '0x172c44ec',
  totalSupply: '0x18160ddd',
  index: '0x2986c0e5',
  twap: '0x10aa790e',
  balanceOf: '0x70a08231',
  pendingFor: '0xd7820452',
  aggregate3: '0x82ad56cb',
}

const FROM_BLOCK = 12_000_000
const START_TIME = 1_784_306_012 // BondDepository startTime(), immutable. Read again on each chain step.
const WINDOW = 10_000_000
const EPOCH_SECONDS = 28_800
const CAP_BPS = 25
const DAY = 86_400_000
const HOLDINGS_MS = 30 * 60_000
const RETRY_MS = 5 * 60_000
const WARM_WAIT_MS = 5_000
const LABELS_OFF = 'Nansen labels are off on this server.'
const STEP_NAME = { chain: 'Chain read', holdings: 'Holdings read', labels: 'Nansen labels' }

const envNumber = (name, fallback, min, max) => {
  const value = Number(process.env[name] ?? fallback)
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback
}
// Read on each use: the Vite config copies .env values into process.env after this module loads.
const chainTtl = () => envNumber('BONDS_TTL_SECONDS', 60, 30, 600) * 1000
const labelTtl = () => envNumber('NANSEN_TTL_MINUTES', 60, 10, 720) * 60_000
const cacheFile = () => process.env.BONDS_CACHE_FILE?.trim() || '.cache/bonds.json'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hex = (n) => `0x${n.toString(16)}`
const word = (data, i) => BigInt(`0x${data.slice(2 + i * 64, 66 + i * 64) || '0'}`)
const units = (value, decimals) => Number(value) / 10 ** decimals
const round = (value, dp) => Math.round(value * 10 ** dp) / 10 ** dp
const arg = (value) => (typeof value === 'string' ? value.slice(2).toLowerCase() : value.toString(16)).padStart(64, '0')
const read = (result, decimals) => (typeof result === 'string' && result.length > 2 ? units(word(result, 0), decimals) : null)
const blockOf = (log) => Number(log.blockNumber)
const addressOnly = (label) => !label.replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s*\[0x[0-9a-f]+\]\s*$/i, '').trim()

const empty = () => ({
  v: 1,
  lastBlock: FROM_BLOCK - 1,
  startTime: START_TIME,
  headBlock: null,
  headTime: null,
  wallets: [],
  bonds: { t: [], w: [], usdg: [], net: [], price: [], block: [] },
  supply: [],
  indexPoints: [],
  labels: {},
  labelsReadThrough: null,
  holdings: null,
  holdingsAt: null,
  live: { bondPrice: null, twap: null, index: null, epoch: null, epochSold: null, supply: null },
  at: {},
})

let state = null
let walletIds = new Map()
let encoded = null
const lanes = { chain: null, slow: null }
const progress = { chain: null, slow: null }
const errors = {}
const failedAt = {}

function load() {
  try {
    const saved = JSON.parse(readFileSync(cacheFile(), 'utf8'))
    const columns = saved?.bonds && Object.values(saved.bonds)
    if (saved?.v === 1 && Array.isArray(saved.wallets) && columns?.length === 6 && columns.every((c) => Array.isArray(c) && c.length === columns[0].length)) {
      return { ...empty(), ...saved }
    }
  } catch {
    // Missing or corrupt cache: start a cold index.
  }
  return empty()
}

function ensure() {
  if (state) return
  state = load()
  walletIds = new Map(state.wallets.map((address, i) => [address, i]))
}

function persist() {
  const file = cacheFile()
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(state))
    renameSync(`${file}.tmp`, file)
  } catch {
    console.warn(`bonds: could not write ${file}`)
  }
}

const changed = () => {
  encoded = null
}
const setProgress = (laneName, step, done, total) => {
  progress[laneName] = { step, done, total }
  changed()
}

/** JSON-RPC batch. Backs off on 429 and transient errors. A revert returns null for that call. */
async function rpc(calls) {
  const body = JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params })))
  for (let attempt = 1; ; attempt++) {
    let failure = 'RPC unreachable'
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null)
    if (response && !response.ok) {
      failure = `RPC HTTP ${response.status}`
      if (response.status !== 429 && response.status < 500) throw new Error(failure)
    }
    const list = response?.ok ? await response.json().catch(() => null) : null
    if (list) {
      const results = new Array(calls.length).fill(null)
      let retry = false
      for (const item of [list].flat()) {
        const message = String(item?.error?.message ?? '')
        if (/exceeds limit/i.test(message)) throw Object.assign(new Error('eth_getLogs exceeds limit'), { tooMany: true })
        if (item?.error && !/revert/i.test(message)) {
          retry = true
          failure = `RPC error ${item.error.code ?? ''}`.trim()
        } else if (Number.isInteger(item?.id)) results[item.id] = item.result ?? null
      }
      if (!retry) {
        await sleep(600)
        return results
      }
    }
    if (attempt >= 10) throw new Error(failure)
    await sleep(3000 * attempt)
  }
}

/** eth_getLogs over one range. Splits the range when the node returns too many logs. */
async function logs(filter, from, to) {
  try {
    const [result] = await rpc([['eth_getLogs', [{ ...filter, fromBlock: hex(from), toBlock: hex(to) }]]])
    if (!Array.isArray(result)) throw new Error('eth_getLogs returned no list')
    return result
  } catch (error) {
    if (!error.tooMany || from >= to) throw error
    const mid = Math.floor((from + to) / 2)
    return [...(await logs(filter, from, mid)), ...(await logs(filter, mid + 1, to))]
  }
}

/** Appends one window of logs. Synchronous, so a failed read never leaves half a window. */
function commit({ bonds, supply, rebases }, times) {
  for (const log of bonds) {
    const depositor = `0x${log.topics[1].slice(26)}`.toLowerCase()
    let id = walletIds.get(depositor)
    if (id === undefined) {
      id = state.wallets.push(depositor) - 1
      walletIds.set(depositor, id)
    }
    const block = blockOf(log)
    state.bonds.t.push(times.get(block))
    state.bonds.w.push(id)
    state.bonds.usdg.push(BigInt(log.topics[2]) === 0n ? round(units(word(log.data, 0), 6), 2) : null)
    state.bonds.net.push(round(units(word(log.data, 1), 9), 6))
    state.bonds.price.push(round(units(word(log.data, 2), 18), 2))
    state.bonds.block.push(block)
  }
  for (const log of supply.sort((a, b) => blockOf(a) - blockOf(b))) {
    const amount = units(word(log.data, 0), 9)
    state.supply.push([blockOf(log), log.topics[1] === ZERO ? amount : -amount])
  }
  for (const log of rebases) state.indexPoints.push([times.get(blockOf(log)), units(word(log.data, 1), 9)])
}

async function indexChain() {
  const [head] = await rpc([['eth_getBlockByNumber', ['latest', false]]])
  const headBlock = Number(head.number)
  const headTime = Number(head.timestamp)

  // Live reads first: this RPC keeps state for recent blocks only.
  setProgress('chain', 'Live reads', 0, 1)
  const at = hex(headBlock)
  const reads = await rpc([
    ['eth_call', [{ to: DEPOSITORY, data: SEL.startTime }, at]],
    ['eth_call', [{ to: DEPOSITORY, data: SEL.bondPrice + arg(0n) }, at]],
    ['eth_call', [{ to: PAIR_ORACLE, data: SEL.twap }, at]],
    ['eth_call', [{ to: SNET, data: SEL.index }, at]],
    ['eth_call', [{ to: NET, data: SEL.totalSupply }, at]],
  ])
  const startTime = read(reads[0], 0) ?? state.startTime
  const epoch = Math.floor((headTime - startTime) / EPOCH_SECONDS)
  const [sold] = await rpc([['eth_call', [{ to: DEPOSITORY, data: SEL.payoutInEpoch + arg(BigInt(epoch)) }, at]]])

  const windows = []
  const total = Math.ceil((headBlock - state.lastBlock) / WINDOW)
  for (let from = state.lastBlock + 1; from <= headBlock; from += WINDOW) {
    setProgress('chain', 'Bond logs', windows.length, total)
    const to = Math.min(from + WINDOW - 1, headBlock)
    windows.push({
      to,
      bonds: await logs({ address: DEPOSITORY, topics: [BOND_TOPIC] }, from, to),
      supply: [
        ...(await logs({ address: NET, topics: [TRANSFER_TOPIC, ZERO] }, from, to)),
        ...(await logs({ address: NET, topics: [TRANSFER_TOPIC, null, ZERO] }, from, to)),
      ],
      rebases: await logs({ address: SNET, topics: [REBASE_TOPIC] }, from, to),
    })
  }

  // Block times, 100 per batch. Each finished window is saved, so a failed cold build resumes there.
  const blocksOf = (window) => [...new Set([...window.bonds, ...window.rebases].map(blockOf))]
  const batches = windows.reduce((sum, window) => sum + Math.ceil(blocksOf(window).length / 100), 0)
  let done = 0
  for (const window of windows) {
    const blocks = blocksOf(window)
    const times = new Map()
    for (let i = 0; i < blocks.length; i += 100) {
      setProgress('chain', 'Block times', done++, batches)
      const slice = blocks.slice(i, i + 100)
      const results = await rpc(slice.map((block) => ['eth_getBlockByNumber', [hex(block), false]]))
      slice.forEach((block, k) => {
        if (!results[k]) throw new Error('Block time missing')
        times.set(block, Number(results[k].timestamp))
      })
    }
    commit(window, times)
    state.lastBlock = window.to
    persist()
  }

  state.startTime = startTime
  state.headBlock = headBlock
  state.headTime = headTime
  state.live = {
    bondPrice: read(reads[1], 18),
    twap: read(reads[2], 18),
    index: read(reads[3], 9),
    epoch,
    epochSold: read(sold, 9),
    supply: read(reads[4], 9),
  }
  // Caps come from mint/burn history. It must add up to totalSupply at the same block.
  const minted = state.supply.reduce((sum, [, delta]) => sum + delta, 0)
  if (state.live.supply !== null && Math.abs(minted - state.live.supply) > 0.001) {
    errors.supply = 'NET mint history does not match totalSupply. Epoch caps can be off.'
  } else delete errors.supply
}

/** Multicall3 aggregate3((address target, bool allowFailure, bytes callData)[]). Many reads, one request. */
function aggregate3(calls) {
  const tuples = calls.map(([target, data]) => {
    const bytes = data.slice(2)
    return arg(target) + arg(1n) + arg(96n) + arg(BigInt(bytes.length / 2)) + bytes.padEnd(Math.ceil(bytes.length / 64) * 64, '0')
  })
  let offset = calls.length * 32
  const offsets = tuples.map((tuple) => {
    const at = offset
    offset += tuple.length / 2
    return arg(BigInt(at))
  })
  return `${SEL.aggregate3}${arg(32n)}${arg(BigInt(calls.length))}${offsets.join('')}${tuples.join('')}`
}

/** Decodes aggregate3's (bool success, bytes returnData)[]. A failed read gives null. */
function aggregate3Results(data) {
  const at = (byte) => Number(word(data, byte / 32)) // every ABI offset here is word aligned
  return Array.from({ length: at(32) }, (_, i) => {
    const tuple = 64 + at(64 + i * 32)
    const bytes = tuple + at(tuple + 32)
    return at(tuple) === 1 ? `0x${data.slice(2 + (bytes + 32) * 2, 2 + (bytes + 32 + at(bytes)) * 2)}` : null
  })
}

async function readHoldings() {
  const wallets = state.wallets.slice()
  const out = {}
  // One Multicall3 eth_call per 100 wallets (400 reads). Plain JSON-RPC batches of 100 calls
  // take ~10 s each on this rate-limited RPC, about 14 min per pass.
  const perCall = 100
  const total = Math.ceil(wallets.length / perCall)
  for (let i = 0; i < wallets.length; i += perCall) {
    setProgress('slow', 'Holdings', i / perCall, total)
    const slice = wallets.slice(i, i + perCall)
    const calls = slice.flatMap((address) => [
      [NET, SEL.balanceOf + arg(address)],
      [SNET, SEL.balanceOf + arg(address)],
      [WSNET, SEL.balanceOf + arg(address)],
      [DEPOSITORY, SEL.pendingFor + arg(address)],
    ])
    const [data] = await rpc([['eth_call', [{ to: MULTICALL, data: aggregate3(calls) }, 'latest']]])
    if (!data) throw new Error('Multicall3 read failed')
    const results = aggregate3Results(data)
    slice.forEach((address, k) => {
      const [net, snet, wsnet, pending] = [9, 9, 18, 9].map((decimals, j) => round(read(results[k * 4 + j], decimals) ?? 0, 6))
      out[address] = [net, snet, wsnet, pending]
    })
  }
  state.holdings = out
  state.holdingsAt = Date.now()
}

async function transfers(key, from, to) {
  const rows = []
  for (let page = 1; page <= 100; page++) {
    const body = JSON.stringify({
      chain: 'robinhood',
      token_address: NET,
      date: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      pagination: { page, per_page: 1000 },
      filters: { from_address: DEPOSITORY },
    })
    let json = null
    for (let attempt = 1; ; attempt++) {
      let status = 0
      try {
        const response = await fetch(NANSEN, {
          method: 'POST',
          headers: { apikey: key, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(60_000),
        })
        status = response.status
        if (response.ok) json = await response.json()
      } catch {
        // Timeout or network error: retry below.
      }
      if (json) break
      // Status only. Nansen error bodies can echo request details.
      const slow = status === 0 || status === 429 || status >= 500
      if (!slow || attempt >= 3) throw Object.assign(new Error(`tgm/transfers HTTP ${status || 'timeout'}`), { slow })
      await sleep(3000)
    }
    const data = Array.isArray(json.data) ? json.data : []
    rows.push(...data)
    if (json.pagination?.is_last_page !== false || data.length < 1000) break
  }
  return rows
}

function addLabel(address, label) {
  if (typeof address !== 'string' || typeof label !== 'string' || !label.trim()) return
  const key = address.toLowerCase()
  const current = state.labels[key]
  // Keep the first real label. An address-only label only fills a gap.
  if (current === undefined || (addressOnly(current) && !addressOnly(label))) state.labels[key] = label.trim()
}

/** Bond buyers who redeemed, with Nansen labels, from the NET payouts out of the depository. */
async function readLabels(key) {
  const end = Date.now()
  let from = state.labelsReadThrough
    ? Date.parse(state.labelsReadThrough) - DAY
    : Math.floor((state.startTime * 1000) / DAY) * DAY
  let span = 7
  let done = 0
  while (from < end) {
    setProgress('slow', 'Nansen labels', done, done + Math.ceil((end - from) / (span * DAY)))
    const to = Math.min(from + span * DAY, end)
    let rows
    try {
      rows = await transfers(key, from, to)
    } catch (error) {
      if (!error.slow || span === 1) throw error
      span = span === 7 ? 3 : 1
      continue
    }
    for (const row of rows) addLabel(row?.to_address, row?.to_address_label)
    state.labelsReadThrough = new Date(to).toISOString().slice(0, 10)
    from = to
    done += 1
    persist()
  }
}

const due = (name, ttl) =>
  Date.now() - (state.at[name] ?? 0) >= ttl && Date.now() - (failedAt[name] ?? 0) >= Math.min(ttl, RETRY_MS)

async function step(name, run) {
  try {
    await run()
    state.at[name] = Date.now()
    delete errors[name]
    delete failedAt[name]
    persist()
  } catch (error) {
    failedAt[name] = Date.now()
    errors[name] = `${STEP_NAME[name]} failed: ${error instanceof Error ? error.message : 'unknown error'}`
  } finally {
    progress[name === 'chain' ? 'chain' : 'slow'] = null
    changed()
  }
}

/** One run per lane at a time. */
function lane(name, work) {
  lanes[name] ??= work()
    .catch(() => {
      errors[name] = 'Bond refresh failed.'
    })
    .finally(() => {
      lanes[name] = null
    })
  return lanes[name]
}

/**
 * Starts every section that is due. Chain reads get their own lane, so a slow
 * holdings or Nansen pass never holds back new blocks.
 */
export function refreshBonds() {
  ensure()
  const chain = lane('chain', async () => {
    if (due('chain', chainTtl())) await step('chain', indexChain)
  })
  const slow = lane('slow', async () => {
    if (state.at.chain && due('holdings', HOLDINGS_MS)) await step('holdings', readHoldings)
    const key = process.env.NANSEN_API_KEY?.trim()
    if (key && due('labels', labelTtl())) await step('labels', () => readLabels(key))
  })
  return Promise.all([chain, slow]).then(() => {})
}

/** The BondFeed payload (see src/lib/bonds.ts). */
export function bondsPayload() {
  ensure()
  const { bonds, supply, live } = state
  const epochCaps = {}
  let running = 0
  for (let i = 0, j = 0; i < bonds.t.length; i++) {
    const epoch = Math.floor((bonds.t[i] - state.startTime) / EPOCH_SECONDS)
    if (epoch in epochCaps) continue
    // Supply before the epoch's first bond. Bonds and supply events are both in block order.
    while (j < supply.length && supply[j][0] < bonds.block[i]) running += supply[j++][1]
    epochCaps[epoch] = round((running * CAP_BPS) / 10_000, 6)
  }
  if (live.epoch !== null && live.supply !== null) epochCaps[live.epoch] = round((live.supply * CAP_BPS) / 10_000, 6)
  const index = live.index ?? state.indexPoints.at(-1)?.[1] ?? null
  const holdings = state.holdings
    ? Object.fromEntries(
        Object.entries(state.holdings).map(([address, [net, snet, wsnet, pending]]) => [
          address,
          round(net + snet + wsnet * (index ?? 1) + pending, 6),
        ]),
      )
    : null
  const key = process.env.NANSEN_API_KEY?.trim()
  return {
    fetchedAt: state.at.chain ?? Date.now(),
    status: state.at.chain ? 'ready' : 'indexing',
    progress: progress.chain ?? progress.slow,
    headBlock: state.headBlock,
    headTime: state.headTime,
    startTime: state.startTime,
    epochSeconds: EPOCH_SECONDS,
    capBps: CAP_BPS,
    wallets: state.wallets,
    bonds,
    epochCaps,
    index,
    indexPoints: state.indexPoints,
    labels: state.labels,
    labelsReadThrough: state.labelsReadThrough,
    holdings,
    holdingsAt: state.holdingsAt,
    live: { bondPrice: live.bondPrice, twap: live.twap, epoch: live.epoch, epochSold: live.epochSold, supply: live.supply },
    errors: [...Object.values(errors), ...(key ? [] : [LABELS_OFF])],
  }
}

/** Node http handler shared by server.mjs and the Vite dev server. */
export async function handleBonds(req, res) {
  try {
    ensure()
    const cold = !state.at.chain
    void refreshBonds()
    // Cold start answers at once with progress. A warm read waits briefly for fresh blocks.
    if (!cold) await Promise.race([lanes.chain, sleep(WARM_WAIT_MS)])
    encoded ??= (() => {
      const json = Buffer.from(JSON.stringify(bondsPayload()))
      return { json, gzip: gzipSync(json) }
    })()
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    res.writeHead(200, {
      'cache-control': state.at.chain ? 'public, max-age=30' : 'no-store',
      'content-type': 'application/json; charset=utf-8',
      vary: 'accept-encoding',
      ...(gzip ? { 'content-encoding': 'gzip' } : {}),
    })
    res.end(gzip ? encoded.gzip : encoded.json)
  } catch {
    res.writeHead(500, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'Bond feed failed.' }))
  }
}
