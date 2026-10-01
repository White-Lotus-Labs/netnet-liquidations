// Same-origin JSON-RPC for the browser's desk reads. The official RPC sometimes sends a doubled
// Access-Control-Allow-Origin header, and the browser then drops the whole response.
// Only the reads src/adapters/rpc.ts sends, one fixed upstream, small bodies, short timeout, a limit per client.

const UPSTREAM = 'https://rpc.mainnet.chain.robinhood.com'
const MARKET = '0x5c60e39a' + 'aa586d26a6fe62d9c0f0948fede6e2130500ac7a655587447e2d4a37e6330589' // Morpho market(Loopback id)
// eth_call targets and calldata, from ADDRESSES and SELECTORS in src (lowercase). src/lib/rpcProxy.test.ts checks they match.
const CALLS = {
  '0xcde9599059f8ae6d6b9f33a0af7877827ec75f16': ['0xa035b1fe'], // Loopback oracle: price()
  '0x929631b33f4070d6f54477fba3fd27566567daca': ['0x10aa790e', '0x1667bcec', '0xbb996e95', '0xcb2701d9'], // pair oracle
  '0x04822ea321a0dee6f40656172f29312104855d66': ['0x1521843e'], // treasury: nav()
  '0xb773ec2c326b7f98a5a83fc098825492f020a4c7': ['0x2986c0e5'], // sNET: index()
  '0x59f95461e68e0c77605299791e1449f175165b54': ['0x0902f1ac', '0x0dfe1681', '0xd21220a7'], // NET/USDG pair
  '0x9d53d5e3bd5e8d4cbfa6db1ca238aea02e651010': [MARKET], // Morpho
}
const MAX_BODY = 16_384
const MAX_CALLS = 32
const TIMEOUT_MS = 10_000
// Viewers poll the same batch. One upstream request per batch per few seconds.
const SHARE_MS = 3_000
const MAX_IN_FLIGHT = 4
const MAX_SHARED = 64
// Per client: a burst of 6 requests, then one every 5 s. The desk polls every 45 s.
const BURST = 6
const REFILL_MS = 5_000

const shared = new Map() // calls without ids → { at, promise }
const buckets = new Map() // client → { tokens, at }
let inFlight = 0

const same = (params, expected) => Array.isArray(params) && params.length === expected.length && expected.every((value, i) => params[i] === value)

/** Checks one JSON-RPC call against the desk's own reads. Returns an error string, or null when the call may pass. */
export function checkCall(call) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) return 'Call must be an object'
  if (call.jsonrpc !== '2.0') return 'jsonrpc must be 2.0'
  const params = call.params ?? []
  switch (call.method) {
    case 'eth_blockNumber':
    case 'eth_chainId':
      return same(params, []) ? null : `${call.method} takes no params`
    case 'eth_getBlockByNumber':
      return same(params, ['latest', false]) ? null : "eth_getBlockByNumber takes ['latest', false]"
    case 'eth_call': {
      const [tx, block] = Array.isArray(params) ? params : []
      if (!Array.isArray(params) || params.length !== 2 || block !== 'latest') return "eth_call takes [{ to, data }, 'latest']"
      if (!tx || typeof tx !== 'object' || Object.keys(tx).some((key) => key !== 'to' && key !== 'data')) return 'eth_call takes to and data only'
      const allowed = typeof tx.to === 'string' ? CALLS[tx.to.toLowerCase()] : undefined
      return allowed && typeof tx.data === 'string' && allowed.includes(tx.data.toLowerCase()) ? null : 'Call not allowed'
    }
    default:
      return 'Method not allowed'
  }
}

/** Parses and checks a request body. Returns { calls } or { error }. */
export function checkBody(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: 'Body is not JSON' }
  }
  const calls = [parsed].flat()
  if (calls.length === 0 || calls.length > MAX_CALLS) return { error: `Send 1 to ${MAX_CALLS} calls` }
  for (const call of calls) {
    const error = checkCall(call)
    if (error) return { error }
  }
  return { calls: parsed }
}

/**
 * The bucket key. Railway's edge sets X-Real-IP to the connecting address. The last X-Forwarded-For hop can
 * be Railway's own proxy, which would put every viewer in one bucket. Elsewhere (Vite dev) the socket peer.
 */
export function clientOf(req) {
  return String(req.headers['x-real-ip'] ?? '').trim() || req.socket?.remoteAddress || 'unknown'
}

/** Token bucket per client. True when the request may pass. */
export function allow(client, now = Date.now()) {
  if (buckets.size > 10_000) for (const [key, bucket] of buckets) if (now - bucket.at > BURST * REFILL_MS) buckets.delete(key)
  const bucket = buckets.get(client) ?? { tokens: BURST, at: now }
  bucket.tokens = Math.min(BURST, bucket.tokens + (now - bucket.at) / REFILL_MS)
  bucket.at = now
  buckets.set(client, bucket)
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    const onData = (chunk) => {
      size += chunk.length
      if (size <= MAX_BODY) return void chunks.push(chunk)
      // Drain the rest, so the 413 reaches the client.
      req.off('data', onData)
      req.resume()
      reject(Object.assign(new Error('Body too large'), { status: 413 }))
    }
    req.on('data', onData)
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function forward(body) {
  inFlight += 1
  try {
    const response = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null)
    // Status only. Upstream error bodies stay upstream.
    if (!response) return { status: 504, json: { error: 'RPC timed out' } }
    if (!response.ok) return { status: 502, json: { error: `RPC HTTP ${response.status}` } }
    const json = await response.json().catch(() => null)
    if (json === null || typeof json !== 'object') return { status: 502, json: { error: 'RPC sent no JSON' } }
    return { status: 200, json }
  } finally {
    inFlight -= 1
  }
}

/** Puts the caller's own ids back on the upstream reply, which used 0..n-1. */
function withIds(json, calls) {
  const restore = (item) => (item && typeof item === 'object' && Number.isInteger(item.id) && item.id < calls.length ? { ...item, id: calls[item.id].id ?? null } : item)
  return Array.isArray(json) ? json.map(restore) : restore(json)
}

function send(res, status, json, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(json))
}

/** Node http handler shared by server.mjs and the Vite dev server. */
export async function handleRpc(req, res) {
  try {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    if (!allow(clientOf(req))) return send(res, 429, { error: 'Too many requests' }, { 'retry-after': String(REFILL_MS / 1000) })
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) return send(res, 415, { error: 'Send application/json' })
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) return send(res, 413, { error: 'Body too large' }, { connection: 'close' })
    const checked = checkBody(await readBody(req))
    if (checked.error) return send(res, 400, { error: checked.error })
    // Ids do not change the reply, so they stay out of the key.
    const calls = [checked.calls].flat()
    const upstream = calls.map((call, id) => ({ jsonrpc: '2.0', id, method: call.method, params: call.params ?? [] }))
    const body = JSON.stringify(Array.isArray(checked.calls) ? upstream : upstream[0])
    const now = Date.now()
    for (const [key, entry] of shared) if (now - entry.at > SHARE_MS) shared.delete(key)
    let entry = shared.get(body)
    if (!entry) {
      if (inFlight >= MAX_IN_FLIGHT || shared.size >= MAX_SHARED) return send(res, 503, { error: 'RPC busy' })
      entry = { at: now, promise: forward(body) }
      shared.set(body, entry)
      // Share a failure only while it is in flight.
      void entry.promise.then(({ status }) => status !== 200 && shared.get(body) === entry && shared.delete(body))
    }
    const { status, json } = await entry.promise
    send(res, status, status === 200 ? withIds(json, calls) : json)
  } catch (error) {
    if (res.headersSent) return
    if (error?.status === 413) send(res, 413, { error: 'Body too large' }, { connection: 'close' })
    else send(res, 400, { error: 'Bad request' })
  }
}
