import { BONDS_ROUTE } from '../config.ts'
import type { BondFeed } from '../lib/bonds.ts'

type FeedHead = Pick<BondFeed, 'fetchedAt' | 'status' | 'progress' | 'headBlock' | 'headTime' | 'live'>

/**
 * Reads /api/bonds. Sends the last ETag; on 304 the server sends only the fields that change on each
 * chain read (x-bonds-head), and the reader merges them into the copy it holds.
 */
export function bondsReader(fetchImpl: typeof fetch = (...args) => fetch(...args), route = BONDS_ROUTE) {
  let held: { etag: string; feed: BondFeed } | null = null
  return async function readBonds(signal: AbortSignal): Promise<BondFeed> {
    const response = await fetchImpl(route, {
      signal,
      // Manual revalidation. The browser cache would parse the whole body again on each 304.
      cache: 'no-store',
      headers: held ? { 'if-none-match': held.etag } : {},
    })
    if (response.status === 304 && held) {
      const head = parseHead(response.headers.get('x-bonds-head'))
      if (!head) throw new Error('Bond feed sent no head')
      held = { etag: held.etag, feed: { ...held.feed, ...head } }
      return held.feed
    }
    const body = (await response.json().catch(() => null)) as (BondFeed & { error?: string }) | null
    if (!response.ok || !body || body.error) throw new Error(body?.error ?? `HTTP ${response.status}`)
    const etag = response.headers.get('etag')
    held = etag && body.status === 'ready' ? { etag, feed: body } : null
    return body
  }
}

function parseHead(value: string | null): FeedHead | null {
  try {
    const head = JSON.parse(value ?? '') as FeedHead
    return head && typeof head === 'object' && typeof head.fetchedAt === 'number' ? head : null
  } catch {
    return null
  }
}

export const readBonds = bondsReader()
