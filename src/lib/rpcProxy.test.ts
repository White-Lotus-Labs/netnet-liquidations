import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { allow, checkBody, clientOf, handleRpc } from '../../rpc.mjs'
import { chainCalls } from '../adapters/rpc.ts'

const call = (method: string, params: unknown[] = []) => ({ jsonrpc: '2.0', id: 0, method, params })
const ORACLE = '0xcde9599059f8ae6d6b9f33a0af7877827ec75f16'

describe('checkBody', () => {
  it("lets the desk's own batch through", () => {
    const body = chainCalls().map((call, id) => ({ jsonrpc: '2.0', id, ...call }))
    expect(checkBody(JSON.stringify(body)).error).toBeUndefined()
    expect(checkBody(JSON.stringify(call('eth_chainId'))).error).toBeUndefined()
  })

  it('refuses other methods, other calls, extra params, and big batches', () => {
    expect(checkBody(JSON.stringify(call('eth_getLogs', [{}]))).error).toBe('Method not allowed')
    expect(checkBody(JSON.stringify(call('eth_sendRawTransaction', ['0x00']))).error).toBe('Method not allowed')
    expect(checkBody(JSON.stringify(call('eth_getBlockByNumber', ['latest', true]))).error).toMatch(/latest/)
    expect(checkBody(JSON.stringify(call('eth_getBlockByNumber', ['0x1', false]))).error).toMatch(/latest/)
    expect(checkBody(JSON.stringify(call('eth_blockNumber', ['x']))).error).toMatch(/no params/)
    expect(checkBody(JSON.stringify(call('eth_call', [{ to: ORACLE, data: '0x12345678' }, 'latest']))).error).toBe('Call not allowed')
    expect(checkBody(JSON.stringify(call('eth_call', [{ to: `0x${'1'.repeat(40)}`, data: '0xa035b1fe' }, 'latest']))).error).toBe('Call not allowed')
    expect(checkBody(JSON.stringify(call('eth_call', [{ to: ORACLE, data: '0xa035b1fe' }, '0x1']))).error).toMatch(/latest/)
    expect(checkBody(JSON.stringify(call('eth_call', [{ to: ORACLE, data: '0xa035b1fe', gas: '0xffffff' }, 'latest']))).error).toMatch(/to and data only/)
    const override = { [ORACLE]: { code: '0x5b600056' } }
    expect(checkBody(JSON.stringify(call('eth_call', [{ to: ORACLE, data: '0xa035b1fe' }, 'latest', override]))).error).toMatch(/latest/)
    expect(checkBody(JSON.stringify(Array.from({ length: 33 }, () => call('eth_chainId')))).error).toMatch(/1 to 32/)
    expect(checkBody('[]').error).toMatch(/1 to 32/)
    expect(checkBody('not json').error).toBe('Body is not JSON')
    expect(checkBody(JSON.stringify({ ...call('eth_chainId'), jsonrpc: '1.0' })).error).toMatch(/2.0/)
  })
})

describe('clientOf', () => {
  it("keys on Railway's X-Real-IP, never on a forwarded hop the client can write", () => {
    const socket = { remoteAddress: '10.0.0.1' }
    const spoofed = { 'x-forwarded-for': '203.0.113.7, 100.64.0.3' }
    expect(clientOf({ headers: { ...spoofed, 'x-real-ip': '198.51.100.4' }, socket } as never)).toBe('198.51.100.4')
    expect(clientOf({ headers: spoofed, socket } as never)).toBe('10.0.0.1')
  })
})

describe('allow', () => {
  it('gives each client a burst, then one request per 5 s', () => {
    const passed = Array.from({ length: 8 }, () => allow('203.0.113.9', 1_000))
    expect(passed).toEqual([true, true, true, true, true, true, false, false])
    expect(allow('203.0.113.9', 6_000)).toBe(true)
    expect(allow('203.0.113.9', 6_000)).toBe(false)
    expect(allow('203.0.113.10', 6_000)).toBe(true)
  })
})

describe('handleRpc', () => {
  const upstream = vi.fn<typeof fetch>()
  beforeAll(() => vi.stubGlobal('fetch', upstream))
  afterAll(() => vi.unstubAllGlobals())

  let client = 0
  // Minimal stand-ins for Node's request and response. Each request comes from its own client.
  const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }, method = 'POST') =>
    new Promise<{ status: number; json: unknown }>((resolve) => {
      const handlers: Record<string, (value?: unknown) => void> = {}
      const req = {
        method,
        headers: { ...headers, 'content-length': String(body.length), 'x-real-ip': `198.51.100.${++client}` },
        socket: {},
        on(event: string, handler: (value?: unknown) => void) {
          handlers[event] = handler
          if (event === 'end')
            queueMicrotask(() => {
              if (body) handlers.data?.(new TextEncoder().encode(body))
              handlers.end?.()
            })
          return req
        },
        off() {},
        resume() {},
      }
      const res = {
        headersSent: false,
        status: 0,
        writeHead(status: number) {
          res.status = status
          res.headersSent = true
        },
        end(text?: string) {
          resolve({ status: res.status, json: text ? JSON.parse(text) : null })
        },
      }
      void handleRpc(req as never, res as never)
    })

  it('shares one upstream read between identical requests', async () => {
    upstream.mockReset()
    upstream.mockImplementation(async () => new Response(JSON.stringify([{ jsonrpc: '2.0', id: 0, result: '0x10' }]), { status: 200 }))
    const [a, b] = await Promise.all([post(JSON.stringify([call('eth_blockNumber')])), post(JSON.stringify([{ ...call('eth_blockNumber'), id: 7 }]))])
    expect(a).toEqual({ status: 200, json: [{ jsonrpc: '2.0', id: 0, result: '0x10' }] })
    // Ids stay out of the key, and each caller gets its own back.
    expect(b).toEqual({ status: 200, json: [{ jsonrpc: '2.0', id: 7, result: '0x10' }] })
    expect(upstream).toHaveBeenCalledTimes(1)
  })

  it('reports upstream failures by status only', async () => {
    upstream.mockReset()
    upstream.mockImplementation(async () => new Response('<html>secret upstream page</html>', { status: 500 }))
    const result = await post(JSON.stringify([call('eth_chainId')]))
    expect(result).toEqual({ status: 502, json: { error: 'RPC HTTP 500' } })
  })

  it('refuses GET, other content types, big bodies, and blocked methods without calling upstream', async () => {
    upstream.mockReset()
    expect((await post('', {}, 'GET')).status).toBe(405)
    expect((await post(JSON.stringify(call('eth_chainId')), { 'content-type': 'text/plain' })).status).toBe(415)
    expect((await post(JSON.stringify(call('eth_call', [{ to: ORACLE, data: `0x${'0'.repeat(20_000)}` }, 'latest'])))).status).toBe(413)
    expect(await post(JSON.stringify(call('eth_getLogs', [{}])))).toEqual({ status: 400, json: { error: 'Method not allowed' } })
    expect(upstream).not.toHaveBeenCalled()
  })
})
