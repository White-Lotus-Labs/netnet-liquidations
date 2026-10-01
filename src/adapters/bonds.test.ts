import { describe, expect, it } from 'vitest'
import { bondsReader } from './bonds.ts'

const feed = { fetchedAt: 1, status: 'ready', headBlock: 10, headTime: 100, progress: null, wallets: ['0xa'], live: { twap: 1 } }

function server() {
  const seen: Array<Record<string, string>> = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    seen.push(headers)
    if (headers['if-none-match'] === 'W/"a"') {
      const head = { fetchedAt: 2, status: 'ready', progress: null, headBlock: 11, headTime: 160, live: { twap: 2 } }
      return new Response(null, { status: 304, headers: { etag: 'W/"a"', 'x-bonds-head': JSON.stringify(head) } })
    }
    return new Response(JSON.stringify(feed), { status: 200, headers: { etag: 'W/"a"' } })
  }) as typeof fetch
  return { seen, fetchImpl }
}

describe('bondsReader', () => {
  it('sends the ETag and merges the head on 304', async () => {
    const { seen, fetchImpl } = server()
    const read = bondsReader(fetchImpl, '/api/bonds')
    const first = await read(new AbortController().signal)
    expect(first.headBlock).toBe(10)
    expect(seen[0]['if-none-match']).toBeUndefined()
    const second = await read(new AbortController().signal)
    expect(seen[1]['if-none-match']).toBe('W/"a"')
    expect(second.headBlock).toBe(11)
    expect(second.live.twap).toBe(2)
    expect(second.wallets).toBe(first.wallets)
  })

  it('does not keep an ETag for a feed that is still indexing', async () => {
    const seen: Array<Record<string, string>> = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push((init.headers ?? {}) as Record<string, string>)
      return new Response(JSON.stringify({ ...feed, status: 'indexing' }), { status: 200, headers: { etag: 'W/"b"' } })
    }) as typeof fetch
    const read = bondsReader(fetchImpl, '/api/bonds')
    await read(new AbortController().signal)
    await read(new AbortController().signal)
    expect(seen[1]['if-none-match']).toBeUndefined()
  })

  it('fails on a 304 without a head', async () => {
    let calls = 0
    const fetchImpl = (async () =>
      calls++ === 0
        ? new Response(JSON.stringify(feed), { status: 200, headers: { etag: 'W/"a"' } })
        : new Response(null, { status: 304 })) as unknown as typeof fetch
    const read = bondsReader(fetchImpl, '/api/bonds')
    await read(new AbortController().signal)
    await expect(read(new AbortController().signal)).rejects.toThrow('no head')
  })
})
