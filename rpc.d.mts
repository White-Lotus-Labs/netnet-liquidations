import type { IncomingMessage, ServerResponse } from 'node:http'

/** Checks one JSON-RPC call against the desk's own reads. Returns an error string, or null when the call may pass. */
export function checkCall(call: unknown): string | null
/** Parses and checks a request body. */
export function checkBody(text: string): { calls: unknown; error?: undefined } | { error: string; calls?: undefined }
/** Token bucket per client. True when the request may pass. */
export function allow(client: string, now?: number): boolean
export function handleRpc(req: IncomingMessage, res: ServerResponse): Promise<void>
