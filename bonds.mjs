// Server-side NetNet bond index for Robinhood Chain.
// Reads bonds from the BondDepository and the four bond desks, NET supply, sNET rebases, desk inventory,
// the manager sleeve's NET flows, NET/USDG candles, buyer holdings, Nansen labels, and buyers' DEX sells.
// Refreshes only when someone asks. Keeps the last good state in memory and on disk.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { gzipSync } from 'node:zlib'

const RPC = 'https://rpc.mainnet.chain.robinhood.com'
// Block times only. These public nodes answer a batch of 100 headers in well under 1 s; the official RPC takes 6-10 s.
// Logs and state reads stay on the official RPC, which is the only one that serves 10M-block log ranges.
const BLOCK_RPCS = (process.env.BONDS_BLOCK_RPCS ?? 'https://rpc.ordofi.network,https://robinhood-rpc.publicnode.com')
  .split(',')
  .map((url) => url.trim())
  .filter((url) => /^https:\/\//.test(url))
const NANSEN = 'https://api.nansen.ai/api/v1/tgm/transfers'
const NANSEN_DEX = 'https://api.nansen.ai/api/v1/tgm/who-bought-sold'
// NET/USDG 4 h candles, USDG per NET, newest first. Free API, about 30 calls a minute.
const CANDLES = 'https://api.geckoterminal.com/api/v2/networks/robinhood/pools/0x59f95461e68e0c77605299791e1449f175165b54/ohlcv/hour?aggregate=4&limit=1000&currency=token'
const DEPOSITORY = '0xff32a969a0c567129eecd926d04657728e1980c1'
const NET = '0xca9c78dd337a67f6e0077f65f5e9218719d30edf'
const SNET = '0xb773ec2c326b7f98a5a83fc098825492f020a4c7'
const WSNET = '0x63c12667638f2ae6fc6ae09b43d98ec84a8586ea'
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
const PAIR_ORACLE = '0x929631b33f4070d6f54477fba3fd27566567daca'
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11' // canonical Multicall3
const MORPHO = '0x9d53d5e3bd5e8d4cbfa6db1ca238aea02e651010'
// wsNET-collateral markets: Loopback and its twin. Collateral is summed.
const MARKETS = [
  '0xaa586d26a6fe62d9c0f0948fede6e2130500ac7a655587447e2d4a37e6330589',
  '0xf47c7a7a1ff6c7444e6fcfa20a71f439e4525f4f9640fe6ba5c080f6f2a9d33f',
]
// NetNet's manager sleeve (team Safe). It buys NET on the DEX and stocks the v3 desk.
const SLEEVE = '0x498752d5fa0600cbd613074c151abe15b3fec7cb'
// Bond desks → the `src` column. Source 0 is the depository, which mints NET at bond time.
// The desks sell NET that was deposited first (InventoryDeposited). Desk bonds vest in the desk.
const DESKS = {
  '0xa84efc3136bf1bb89ade9e5be6ab32cb1a04f08d': 1, // RWA bond desk v2, DeskBond
  '0x2f2f215b810fa692304cb0095804ab3c8e4cef78': 2, // asset bond desk, AssetBond
  '0x732b3d1d3e8912cae75164fa14a6e1c4c64615b3': 3, // sleeve bond desk (v3), DeskBond, no Treasury fee
  '0x99b6ee6ede47d9a8a9bfd03f728a99b789df1961': 4, // RWA bond desk v1, DeskBond, 2026-07-24 to 2026-08-27
}

const BOND_TOPIC = '0xd52c75b244055af9364c0a5dc0da7868f6ae104012f245ad2702031af04d9b8e'
// DeskBond(address indexed to, address indexed rwaToken, usdgIn, payout, priceWad, fee, rwaOut)
const DESK_BOND_TOPIC = '0x2cfcb3ca367d7f7d6165a0805c4c4e8f66a29641cae4d57667d135fac29129e9'
// AssetBond(address indexed to, address indexed token, amountIn, valueWad, payout, priceWad, fee, feeAssetRaw, toSleeve)
const ASSET_BOND_TOPIC = '0xdec46cdd0be10d522b17d462ec4f74dd8f90bd2a62eab8d79d863e0c7845af26'
// InventoryDeposited(amount, newInventory)
const INVENTORY_TOPIC = '0x8c659e8002149653e7d4cc7bf86afdabac70f806574c8e709329fb76a5a71681'
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
  pendingFor: '0xd7820452', // same selector on the depository and the desks
  position: '0x93c52062', // Morpho position(bytes32 id, address user)
  aggregate3: '0x82ad56cb',
}

const FROM_BLOCK = 12_000_000
const START_TIME = 1_784_306_012 // BondDepository startTime(), immutable. Read again on each chain step.
const WINDOW = 10_000_000
const EPOCH_SECONDS = 28_800
const CAP_BPS = 25
const DAY = 86_400_000
const HOLDINGS_MS = 30 * 60_000
const PRICE_MS = 30 * 60_000
const RETRY_MS = 5 * 60_000
const WARM_WAIT_MS = 5_000
const LABELS_OFF = 'Nansen labels are off on this server.'
const STEP_NAME = { chain: 'Chain read', price: 'Price read', holdings: 'Holdings read', labels: 'Nansen labels', dex: 'Nansen DEX sells' }
const LANE_OF = { chain: 'chain', price: 'chain', holdings: 'slow', labels: 'slow', dex: 'dex' }
const LAUNCH = '2026-07-17T00:00:00.000Z'
// The first desk bond (RWA desk v1) is from 2026-07-24. Older caches read labels from fewer bond contracts.
const DESK_LABELS_FROM = '2026-07-24'
const DEX_DAYS = { '24h': 1, '7d': 7, '14d': 14, '30d': 30, all: null } // null = since LAUNCH
const DEX_PAGES = 40 // per window, 1,000 rows and 1 credit each
const COLUMNS = ['t', 'w', 'usdg', 'net', 'price', 'block', 'src']

const envNumber = (name, fallback, min, max) => {
  const value = Number(process.env[name] ?? fallback)
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback
}
// Read on each use: the Vite config copies .env values into process.env after this module loads.
const chainTtl = () => envNumber('BONDS_TTL_SECONDS', 60, 30, 600) * 1000
const labelTtl = () => envNumber('NANSEN_TTL_MINUTES', 60, 10, 720) * 60_000
const dexTtl = () => envNumber('BONDS_DEX_TTL_MINUTES', 180, 30, 1440) * 60_000
const cacheFile = () => process.env.BONDS_CACHE_FILE?.trim() || '.cache/bonds.json'

// Errors this module writes. Only these reach the page; any other message can quote upstream data.
const fail = (message, extra) => Object.assign(new Error(message), { public: true }, extra)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const hex = (n) => `0x${n.toString(16)}`
const word = (data, i) => BigInt(`0x${data.slice(2 + i * 64, 66 + i * 64) || '0'}`)
const units = (value, decimals) => Number(value) / 10 ** decimals
const round = (value, dp) => Math.round(value * 10 ** dp) / 10 ** dp
const arg = (value) => (typeof value === 'string' ? value.slice(2).toLowerCase() : value.toString(16)).padStart(64, '0')
const read = (result, decimals) => (typeof result === 'string' && result.length > 2 ? units(word(result, 0), decimals) : null)
const blockOf = (log) => Number(log.blockNumber)
const addressAt = (topic) => `0x${topic.slice(26)}`.toLowerCase()
const addressOnly = (label) => !label.replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s*\[0x[0-9a-f]+\]\s*$/i, '').trim()

// One value per topic position: this RPC allows 10M-block spans only for single-value filters.
const CORE_LOGS = [
  { address: DEPOSITORY, topics: [BOND_TOPIC] },
  { address: NET, topics: [TRANSFER_TOPIC, ZERO] },
  { address: NET, topics: [TRANSFER_TOPIC, null, ZERO] },
  { address: SNET, topics: [REBASE_TOPIC] },
]
const DESK_LOGS = [
  ...Object.entries(DESKS).flatMap(([address, src]) => [
    { address, topics: [src === 2 ? ASSET_BOND_TOPIC : DESK_BOND_TOPIC] },
    { address, topics: [INVENTORY_TOPIC] },
  ]),
  { address: NET, topics: [TRANSFER_TOPIC, null, `0x${arg(SLEEVE)}`] }, // NET into the sleeve
  { address: NET, topics: [TRANSFER_TOPIC, `0x${arg(SLEEVE)}`] }, // NET out of the sleeve
  { address: USDG, topics: [TRANSFER_TOPIC, `0x${arg(SLEEVE)}`] }, // USDG the sleeve paid
]

/**
 * One bond from a BondCreated, DeskBond, or AssetBond log. `usdg` is the USDG paid (asset desk: the
 * USD value of the asset paid); null for depository market 1, which takes the NET/USDG LP token.
 */
export function decodeBond(log) {
  const at = log.address.toLowerCase()
  const src = at === DEPOSITORY ? 0 : DESKS[at]
  // Data words of [USD in, NET payout, price] and the USD decimals.
  const [usd, payout, price, decimals] = log.topics[0] === ASSET_BOND_TOPIC ? [1, 2, 3, 18] : [0, 1, 2, 6]
  const lp = src === 0 && BigInt(log.topics[2]) !== 0n
  return {
    src,
    depositor: addressAt(log.topics[1]),
    usdg: lp ? null : round(units(word(log.data, usd), decimals), 2),
    net: round(units(word(log.data, payout), 9), 6),
    price: round(units(word(log.data, price), 18), 2),
  }
}

/**
 * The sleeve's NET flows, one row per transaction and kind. NET in, in a transaction where the sleeve
 * also paid USDG, is a DEX buy (`usd` = USDG paid). NET out to a bond desk is desk inventory.
 */
export function sleeveFlows(inLogs, outLogs, paidLogs) {
  const paid = new Map()
  for (const log of paidLogs) paid.set(log.transactionHash, (paid.get(log.transactionHash) ?? 0) + units(word(log.data, 0), 6))
  const rows = new Map()
  const add = (log, kind, usd) => {
    const key = `${log.transactionHash}:${kind}`
    const row = rows.get(key) ?? { block: blockOf(log), net: 0, kind, usd }
    row.net += units(word(log.data, 0), 9)
    rows.set(key, row)
  }
  for (const log of inLogs) add(log, paid.has(log.transactionHash) ? 'buy' : 'other-in', paid.get(log.transactionHash) ?? 0)
  for (const log of outLogs) add(log, addressAt(log.topics[2]) in DESKS ? 'desk' : 'other-out', 0)
  return [...rows.values()].sort((a, b) => a.block - b.block)
}

/** One desk inventory deposit. `minted` is 1 when `supply` has a mint of the same amount in the same block. */
export function inventoryRow(log, supply) {
  const block = blockOf(log)
  const net = units(word(log.data, 0), 9)
  const minted = supply.some(([at, delta]) => at === block && Math.abs(delta - net) < 1e-9)
  return { block, src: DESKS[log.address.toLowerCase()], net: round(net, 6), minted: minted ? 1 : 0 }
}

const empty = () => ({
  v: 4,
  lastBlock: FROM_BLOCK - 1, // depository, supply, and rebase logs read through this block
  deskBlock: FROM_BLOCK - 1, // desk and sleeve logs read through this block
  startTime: START_TIME,
  headBlock: null,
  headTime: null,
  wallets: [],
  bonds: { t: [], w: [], usdg: [], net: [], price: [], block: [], src: [] },
  supply: [],
  indexPoints: [],
  inventory: [], // [t, src, NET, 1 when minted in the same transaction]
  sleeve: [], // [t, NET, kind, USDG paid]
  price: [], // [t, close]
  labels: {},
  labelsReadThrough: null,
  holdings: null, // address: [NET, sNET, wsNET, wsNET in Morpho, pending NET (depository + desks)], token units
  holdingsAt: null,
  dex: null,
  live: { bondPrice: null, twap: null, index: null, epoch: null, epochSold: null, supply: null },
  at: {},
})

let state = null
let walletIds = new Map()
let encoded = null
const lanes = { chain: null, slow: null, dex: null }
const progress = { chain: null, slow: null, dex: null }
const errors = {}
const failedAt = {}

function load() {
  try {
    const saved = JSON.parse(readFileSync(cacheFile(), 'utf8'))
    const length = saved?.bonds?.t?.length
    if ([1, 2, 3, 4].includes(saved?.v) && Array.isArray(saved.wallets) && Number.isInteger(length)) {
      if (saved.v === 3) {
        // v3 missed RWA desk v1. Drop the desk rows and read every desk again; depository rows stay.
        const keep = saved.bonds.src.map((src, i) => (src ? -1 : i)).filter((i) => i >= 0)
        for (const key of COLUMNS) saved.bonds[key] = keep.map((i) => saved.bonds[key][i])
        saved.inventory = []
        saved.sleeve = []
        saved.deskBlock = FROM_BLOCK - 1
        if (saved.labelsReadThrough && saved.labelsReadThrough > DESK_LABELS_FROM) saved.labelsReadThrough = DESK_LABELS_FROM
        delete saved.at?.holdings
      }
      if (saved.v < 3) {
        // v1 and v2 hold depository bonds only. Keep them; read the desks from FROM_BLOCK (deskBlock).
        saved.bonds.src = new Array(length).fill(0)
        // Desk buyers redeem from the desks: read labels again from the first desk day.
        if (saved.labelsReadThrough && saved.labelsReadThrough > DESK_LABELS_FROM) saved.labelsReadThrough = DESK_LABELS_FROM
        // Holdings now add desk vesting. Keep the old read on screen until the next one.
        delete saved.at?.holdings
      }
      if (saved.v === 1) {
        // v1 holdings have no Morpho collateral.
        saved.holdings = null
        saved.holdingsAt = null
      }
      const rows = saved.bonds.t.length
      if (COLUMNS.every((key) => Array.isArray(saved.bonds[key]) && saved.bonds[key].length === rows)) return { ...empty(), ...saved, v: 4 }
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
// Progress is in the head, which is encoded on each request.
const setProgress = (laneName, step, done, total) => {
  progress[laneName] = { step, done, total }
}

/** JSON-RPC batch. Backs off on 429 and transient errors. A revert returns null for that call. */
async function rpc(calls, { url = RPC, tries = 10, pause = 600 } = {}) {
  const body = JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params })))
  for (let attempt = 1; ; attempt++) {
    let failure = 'RPC unreachable'
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null)
    if (response && !response.ok) {
      failure = `RPC HTTP ${response.status}`
      if (response.status !== 429 && response.status < 500) throw fail(failure)
    }
    const list = response?.ok ? await response.json().catch(() => null) : null
    if (list) {
      const results = new Array(calls.length).fill(null)
      let retry = false
      for (const item of [list].flat()) {
        const message = String(item?.error?.message ?? '')
        if (/exceeds limit/i.test(message)) throw fail('eth_getLogs exceeds limit', { tooMany: true })
        if (item?.error && !/revert/i.test(message)) {
          retry = true
          failure = Number.isInteger(item.error.code) ? `RPC error ${item.error.code}` : 'RPC error'
        } else if (Number.isInteger(item?.id)) results[item.id] = item.result ?? null
      }
      if (!retry) {
        await sleep(pause)
        return results
      }
    }
    if (attempt >= tries) throw fail(failure)
    await sleep(3000 * attempt)
  }
}

/** Block timestamps. Fast public nodes first; a result counts only when its number matches the block asked for. */
async function blockTimes(blocks) {
  const calls = blocks.map((block) => ['eth_getBlockByNumber', [hex(block), false]])
  const valid = (results) => results?.length === blocks.length && results.every((row, k) => row && Number(row.number) === blocks[k])
  for (const url of BLOCK_RPCS) {
    const results = await rpc(calls, { url, tries: 2, pause: 50 }).catch(() => null)
    if (valid(results)) return results.map((row) => Number(row.timestamp))
  }
  const results = await rpc(calls)
  if (!valid(results)) throw fail('Block time missing')
  return results.map((row) => Number(row.timestamp))
}

/** eth_getLogs for several filters over one range, in one batch. Splits the range when the node returns too many logs. */
async function logs(filters, from, to) {
  try {
    const results = await rpc(filters.map((filter) => ['eth_getLogs', [{ ...filter, fromBlock: hex(from), toBlock: hex(to) }]]))
    if (!results.every(Array.isArray)) throw fail('eth_getLogs returned no list')
    return results
  } catch (error) {
    if (!error.tooMany || from >= to) throw error
    const mid = Math.floor((from + to) / 2)
    const low = await logs(filters, from, mid)
    const high = await logs(filters, mid + 1, to)
    return low.map((list, i) => [...list, ...high[i]])
  }
}

/** Logs above `cursor` inside [from, to]. A source that is already read returns empty lists. */
const logsAfter = (cursor, filters, from, to) => (cursor >= to ? filters.map(() => []) : logs(filters, Math.max(from, cursor + 1), to))

/** Appends one window of logs. Synchronous, so a failed read never leaves half a window. */
function commit({ bonds, supply, rebases, inventory, sleeve }, times) {
  // Supply first: inventory checks it for a same-block mint.
  for (const log of supply.sort((a, b) => blockOf(a) - blockOf(b))) {
    const amount = units(word(log.data, 0), 9)
    state.supply.push([blockOf(log), log.topics[1] === ZERO ? amount : -amount])
  }
  const lastBlock = state.bonds.block.at(-1) ?? 0
  for (const log of bonds.sort((a, b) => blockOf(a) - blockOf(b) || Number(a.logIndex) - Number(b.logIndex))) {
    const bond = decodeBond(log)
    let id = walletIds.get(bond.depositor)
    if (id === undefined) {
      id = state.wallets.push(bond.depositor) - 1
      walletIds.set(bond.depositor, id)
    }
    const block = blockOf(log)
    state.bonds.t.push(times.get(block))
    state.bonds.w.push(id)
    state.bonds.usdg.push(bond.usdg)
    state.bonds.net.push(bond.net)
    state.bonds.price.push(bond.price)
    state.bonds.block.push(block)
    state.bonds.src.push(bond.src)
  }
  // A new source backfills blocks the depository already passed. Keep the columns in block order.
  if (bonds.length && Math.min(...bonds.map(blockOf)) < lastBlock) {
    const order = state.bonds.block.map((_, i) => i).sort((a, b) => state.bonds.block[a] - state.bonds.block[b])
    for (const key of COLUMNS) state.bonds[key] = order.map((i) => state.bonds[key][i])
  }
  for (const log of rebases) state.indexPoints.push([times.get(blockOf(log)), units(word(log.data, 1), 9)])
  for (const log of inventory.sort((a, b) => blockOf(a) - blockOf(b))) {
    // v2 and asset desk stock is minted to the team multisig in the deposit transaction.
    const row = inventoryRow(log, state.supply)
    state.inventory.push([times.get(row.block), row.src, row.net, row.minted])
  }
  for (const row of sleeve) state.sleeve.push([times.get(row.block), round(row.net, 6), row.kind, round(row.usd, 2)])
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

  // Each source reads above its own cursor, so a new source backfills without reading the others again.
  const windows = []
  const start = Math.min(state.lastBlock, state.deskBlock) + 1
  const total = Math.ceil((headBlock - start + 1) / WINDOW)
  for (let from = start; from <= headBlock; from += WINDOW) {
    setProgress('chain', 'Bond logs', windows.length, total)
    const to = Math.min(from + WINDOW - 1, headBlock)
    const [bonds, mints, burns, rebases] = await logsAfter(state.lastBlock, CORE_LOGS, from, to)
    const desk = await logsAfter(state.deskBlock, DESK_LOGS, from, to)
    const deskLogs = desk.slice(0, -3).flat()
    windows.push({
      to,
      bonds: [...bonds, ...deskLogs.filter((log) => log.topics[0] !== INVENTORY_TOPIC)],
      supply: [...mints, ...burns],
      rebases,
      inventory: deskLogs.filter((log) => log.topics[0] === INVENTORY_TOPIC),
      sleeve: sleeveFlows(...desk.slice(-3)),
    })
  }

  // Block times, 100 per batch. Each finished window is saved, so a failed cold build resumes there.
  const blocksOf = (window) => [...new Set([...window.bonds, ...window.rebases, ...window.inventory].map(blockOf).concat(window.sleeve.map((row) => row.block)))]
  const batches = windows.reduce((sum, window) => sum + Math.ceil(blocksOf(window).length / 100), 0)
  let done = 0
  for (const window of windows) {
    const blocks = blocksOf(window)
    const times = new Map()
    for (let i = 0; i < blocks.length; i += 100) {
      setProgress('chain', 'Block times', done++, batches)
      const slice = blocks.slice(i, i + 100)
      const stamps = await blockTimes(slice)
      slice.forEach((block, k) => times.set(block, stamps[k]))
    }
    commit(window, times)
    state.lastBlock = Math.max(state.lastBlock, window.to)
    state.deskBlock = Math.max(state.deskBlock, window.to)
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

/** NET/USDG 4 h closes from GeckoTerminal. Older candles stay when the API window moves past them. */
async function readPrice() {
  const response = await fetch(CANDLES, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }).catch(() => {
    throw fail('GeckoTerminal unreachable')
  })
  if (!response.ok) throw fail(`GeckoTerminal HTTP ${response.status}`)
  const list = (await response.json().catch(() => null))?.data?.attributes?.ohlcv_list
  if (!Array.isArray(list) || list.length === 0) throw fail('GeckoTerminal returned no candles')
  const closes = new Map(state.price)
  for (const row of list) if (Number.isFinite(row?.[0]) && Number.isFinite(row?.[4])) closes.set(row[0], round(row[4], 4))
  state.price = [...closes].sort((a, b) => a[0] - b[0])
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

/** Morpho position() returns (supplyShares, borrowShares, collateral). Collateral is wsNET, 18 decimals. */
const collateral = (result) => (typeof result === 'string' && result.length >= 2 + 3 * 64 ? units(word(result, 2), 18) : 0)

async function readHoldings() {
  const wallets = state.wallets.slice()
  // Bonds after this moment may be missing from the reads below. The client counts only bonds up to holdingsAt.
  const startedAt = Date.now()
  // Desk bonds vest in the desk: read pendingFor on each desk the wallet bonded at.
  const deskAddress = Object.fromEntries(Object.entries(DESKS).map(([address, src]) => [src, address]))
  const desksOf = new Map()
  state.bonds.src.forEach((src, i) => {
    if (!src) return
    const address = state.wallets[state.bonds.w[i]]
    desksOf.set(address, new Set(desksOf.get(address)).add(deskAddress[src]))
  })
  const out = {}
  // One Multicall3 eth_call per 100 wallets (about 600 reads). Plain JSON-RPC batches of 100 calls
  // take ~10 s each on this rate-limited RPC, about 14 min per pass.
  const perCall = 100
  const total = Math.ceil(wallets.length / perCall)
  for (let i = 0; i < wallets.length; i += perCall) {
    setProgress('slow', 'Holdings', i / perCall, total)
    const slice = wallets.slice(i, i + perCall)
    const reads = slice.map((address) => [
      [NET, SEL.balanceOf + arg(address)],
      [SNET, SEL.balanceOf + arg(address)],
      [WSNET, SEL.balanceOf + arg(address)],
      ...MARKETS.map((id) => [MORPHO, SEL.position + arg(id) + arg(address)]),
      ...[DEPOSITORY, ...(desksOf.get(address) ?? [])].map((target) => [target, SEL.pendingFor + arg(address)]),
    ])
    const [data] = await rpc([['eth_call', [{ to: MULTICALL, data: aggregate3(reads.flat()) }, 'latest']]])
    if (!data) throw fail('Multicall3 read failed')
    const results = aggregate3Results(data)
    let at = 0
    slice.forEach((address, k) => {
      const row = results.slice(at, (at += reads[k].length))
      const [net, snet, wsnet] = [9, 9, 18].map((decimals, j) => read(row[j], decimals) ?? 0)
      const looped = row.slice(3, 3 + MARKETS.length).reduce((sum, result) => sum + collateral(result), 0)
      const pending = row.slice(3 + MARKETS.length).reduce((sum, result) => sum + (read(result, 9) ?? 0), 0)
      out[address] = [net, snet, wsnet, looped, pending].map((value) => round(value, 6))
    })
  }
  state.holdings = out
  state.holdingsAt = startedAt
}

/** Pages through one Nansen query, 1,000 rows per page. `capped` is true when more pages remain after maxPages. */
async function nansenPages(key, url, query, maxPages) {
  const rows = []
  let credits = 0
  for (let page = 1; page <= maxPages; page++) {
    const body = JSON.stringify({ ...query, pagination: { page, per_page: 1000 } })
    let json = null
    for (let attempt = 1; ; attempt++) {
      let status = 0
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { apikey: key, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(60_000),
        })
        status = response.status
        credits += Number(response.headers.get('x-nansen-credits-cost')) || 0
        if (response.ok) json = await response.json()
      } catch {
        // Timeout or network error: retry below.
      }
      if (json) break
      // Status only. Nansen error bodies can echo request details.
      const slow = status === 0 || status === 429 || status >= 500
      if (!slow || attempt >= 3) throw fail(`${url.slice(url.indexOf('tgm/'))} HTTP ${status || 'timeout'}`, { slow })
      await sleep(3000)
    }
    const data = Array.isArray(json.data) ? json.data : []
    rows.push(...data)
    if (json.pagination?.is_last_page !== false || data.length < 1000) return { rows, credits, pages: page, capped: false }
  }
  return { rows, credits, pages: maxPages, capped: true }
}

/** NET paid out by the depository and the desks: bond redemptions. */
async function transfers(key, from, to) {
  const query = {
    chain: 'robinhood',
    token_address: NET,
    date: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    filters: { from_address: [DEPOSITORY, ...Object.keys(DESKS)] },
  }
  return nansenPages(key, NANSEN, query, 100)
}

const volume = (value, dp) => round(Number(value) || 0, dp)

/** NET that bond buyers sold (and bought) on the DEX, per window, from Nansen who-bought-sold. DEX trades only. */
async function readDex(key) {
  const now = Date.now()
  const to = new Date(now).toISOString()
  const windows = {}
  const capped = []
  let pages = 0
  let credits = 0
  for (const [name, days] of Object.entries(DEX_DAYS)) {
    setProgress('dex', 'Nansen DEX sells', Object.keys(windows).length, Object.keys(DEX_DAYS).length)
    const from = days === null ? LAUNCH : new Date(now - days * DAY).toISOString()
    const read = await nansenPages(key, NANSEN_DEX, { chain: 'robinhood', token_address: NET, buy_or_sell: 'SELL', date: { from, to } }, DEX_PAGES)
    pages += read.pages
    credits += read.credits
    if (read.capped) capped.push(name)
    const rows = {}
    for (const row of read.rows) {
      const address = typeof row?.address === 'string' ? row.address.toLowerCase() : ''
      if (!walletIds.has(address)) continue
      rows[address] = [volume(row.sold_token_volume, 6), volume(row.sold_volume_usd, 2), volume(row.bought_token_volume, 6), volume(row.bought_volume_usd, 2)]
      addLabel(address, row.address_label)
    }
    windows[name] = { from, to, rows }
  }
  state.dex = { at: now, windows }
  if (capped.length) errors.dexCap = `Nansen DEX sells stop at ${DEX_PAGES} pages for ${capped.join(', ')}. Smaller sellers are left out.`
  else delete errors.dexCap
  console.log(`bonds: Nansen DEX sells read, ${pages} pages, ${credits} credits`)
}

function addLabel(address, label) {
  if (typeof address !== 'string' || typeof label !== 'string' || !label.trim()) return
  const key = address.toLowerCase()
  const current = state.labels[key]
  // Keep the first real label. An address-only label only fills a gap.
  if (current === undefined || (addressOnly(current) && !addressOnly(label))) state.labels[key] = label.trim()
}

/** Bond buyers who redeemed, with Nansen labels, from the NET payouts out of the depository and the desks. */
async function readLabels(key) {
  const end = Date.now()
  let from = state.labelsReadThrough
    ? Date.parse(state.labelsReadThrough) - DAY
    : Math.floor((state.startTime * 1000) / DAY) * DAY
  let span = 7
  let done = 0
  let credits = 0
  while (from < end) {
    setProgress('slow', 'Nansen labels', done, done + Math.ceil((end - from) / (span * DAY)))
    const to = Math.min(from + span * DAY, end)
    let rows
    try {
      const read = await transfers(key, from, to)
      rows = read.rows
      credits += read.credits
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
  console.log(`bonds: Nansen labels read, ${done} date ranges, ${credits} credits`)
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
    if (!error?.public) console.warn(`bonds: ${name} failed`, error)
    errors[name] = error?.public ? `${STEP_NAME[name]} failed: ${error.message}` : `${STEP_NAME[name]} failed.`
  } finally {
    progress[LANE_OF[name]] = null
    changed()
  }
}

/** One run per lane at a time. */
function lane(name, work) {
  lanes[name] ??= work()
    .catch(() => {
      errors[name] = 'Bond refresh failed.'
      changed()
    })
    .finally(() => {
      lanes[name] = null
    })
  return lanes[name]
}

// Holdings and DEX sells cover every bond buyer, so they wait until each bond source is read.
const indexed = () => Boolean(state.at.chain) && state.deskBlock >= state.lastBlock

/**
 * Starts every section that is due. Chain reads get their own lane, so a slow
 * holdings or Nansen pass never holds back new blocks. DEX sells run in a third lane.
 */
export function refreshBonds() {
  ensure()
  const key = process.env.NANSEN_API_KEY?.trim()
  const chain = lane('chain', async () => {
    if (due('chain', chainTtl())) await step('chain', indexChain)
    if (due('price', PRICE_MS)) await step('price', readPrice)
  })
  const slow = lane('slow', async () => {
    if (indexed() && due('holdings', HOLDINGS_MS)) await step('holdings', readHoldings)
    if (key && due('labels', labelTtl())) await step('labels', () => readLabels(key))
  })
  const dex = lane('dex', async () => {
    if (key && indexed() && due('dex', dexTtl())) await step('dex', () => readDex(key))
  })
  return Promise.all([chain, slow, dex]).then(() => {})
}

/** The fields that change on every chain read. The ETag leaves them out, and a 304 carries them in x-bonds-head. */
function bondsHead() {
  const { live } = state
  return {
    fetchedAt: state.at.chain ?? Date.now(),
    status: state.at.chain ? 'ready' : 'indexing',
    progress: progress.chain ?? progress.slow ?? progress.dex,
    headBlock: state.headBlock,
    headTime: state.headTime,
    live: { bondPrice: live.bondPrice, twap: live.twap, epoch: live.epoch, epochSold: live.epochSold, supply: live.supply },
  }
}

/** Everything else. The block column stays on the server. */
function bondsData() {
  const { bonds, supply, live } = state
  const epochCaps = {}
  let running = 0
  for (let i = 0, j = 0; i < bonds.t.length; i++) {
    const epoch = Math.floor((bonds.t[i] - state.startTime) / EPOCH_SECONDS)
    // Only depository bonds have a cap.
    if (bonds.src[i] !== 0 || epoch in epochCaps) continue
    // Supply before the epoch's first bond. Bonds and supply events are both in block order.
    while (j < supply.length && supply[j][0] < bonds.block[i]) running += supply[j++][1]
    epochCaps[epoch] = round((running * CAP_BPS) / 10_000, 6)
  }
  if (live.epoch !== null && live.supply !== null) epochCaps[live.epoch] = round((live.supply * CAP_BPS) / 10_000, 6)
  const index = live.index ?? state.indexPoints.at(-1)?.[1] ?? null
  // [liquid, staked, wrapped, looped, vesting], all in NET terms.
  const holdings = state.holdings
    ? Object.fromEntries(
        Object.entries(state.holdings).map(([address, [net, snet, wsnet, looped, pending]]) => [
          address,
          [net, snet, wsnet * (index ?? 1), looped * (index ?? 1), pending].map((value) => round(value, 6)),
        ]),
      )
    : null
  const key = process.env.NANSEN_API_KEY?.trim()
  return {
    startTime: state.startTime,
    epochSeconds: EPOCH_SECONDS,
    capBps: CAP_BPS,
    wallets: state.wallets,
    bonds: { t: bonds.t, w: bonds.w, usdg: bonds.usdg, net: bonds.net, price: bonds.price, src: bonds.src },
    epochCaps,
    index,
    indexPoints: state.indexPoints,
    inventory: state.inventory,
    sleeve: state.sleeve,
    price: state.price,
    labels: state.labels,
    labelsReadThrough: state.labelsReadThrough,
    holdings,
    holdingsAt: state.holdingsAt,
    dex: state.dex,
    errors: [...Object.values(errors), ...(key ? [] : [LABELS_OFF])],
  }
}

/** The BondFeed payload (see src/lib/bonds.ts). */
export function bondsPayload() {
  ensure()
  return { ...bondsHead(), ...bondsData() }
}

/**
 * The encoded feed. The data part and its ETag change only when the data changes; the body is
 * encoded again when the head changes too.
 */
function encode() {
  if (!encoded) {
    const data = JSON.stringify(bondsData())
    encoded = { data, etag: `W/"${createHash('sha1').update(data).digest('base64url')}"`, head: null, json: null, gzip: null }
  }
  const head = JSON.stringify(bondsHead())
  if (encoded.head !== head) {
    const json = Buffer.from(`${head.slice(0, -1)},${encoded.data.slice(1)}`)
    Object.assign(encoded, { head, json, gzip: gzipSync(json) })
  }
  return encoded
}

/** Weak comparison, as RFC 9110 asks for If-None-Match. */
export function etagMatches(header, etag) {
  if (typeof header !== 'string' || !header) return false
  const strip = (tag) => tag.trim().replace(/^W\//, '')
  return header.split(',').some((tag) => tag.trim() === '*' || strip(tag) === strip(etag))
}

/** Node http handler shared by server.mjs and the Vite dev server. */
export async function handleBonds(req, res) {
  try {
    ensure()
    const cold = !state.at.chain
    void refreshBonds()
    // Cold start answers at once with progress. A warm read waits briefly for fresh blocks.
    if (!cold) await Promise.race([lanes.chain, sleep(WARM_WAIT_MS)])
    const { etag, head, json, gzip } = encode()
    const headers = {
      'cache-control': state.at.chain ? 'no-cache' : 'no-store',
      etag,
      vary: 'accept-encoding',
    }
    // Same data as the copy the client holds: send the head only.
    if (state.at.chain && etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, { ...headers, 'x-bonds-head': head })
      res.end()
      return
    }
    const zipped = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    res.writeHead(200, {
      ...headers,
      'content-type': 'application/json; charset=utf-8',
      ...(zipped ? { 'content-encoding': 'gzip' } : {}),
    })
    res.end(zipped ? gzip : json)
  } catch {
    res.writeHead(500, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'Bond feed failed.' }))
  }
}
