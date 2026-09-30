import type { IncomingMessage, ServerResponse } from 'node:http'

export function refreshBonds(): Promise<void>
/** BondFeed from src/lib/bonds.ts. */
export function bondsPayload(): Record<string, unknown>
export function handleBonds(req: IncomingMessage, res: ServerResponse): Promise<void>
