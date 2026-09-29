import type { IncomingMessage, ServerResponse } from 'node:http'

export function nansenSnapshot(): Promise<{ status: number; body: unknown }>
export function handleNansen(req: IncomingMessage, res: ServerResponse): Promise<void>
