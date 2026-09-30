import type { IncomingMessage, ServerResponse } from 'node:http'

type Log = { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex?: string }

export function refreshBonds(): Promise<void>
/** BondFeed from src/lib/bonds.ts. */
export function bondsPayload(): Record<string, unknown>
export function handleBonds(req: IncomingMessage, res: ServerResponse): Promise<void>
/** One bond from a BondCreated, DeskBond, or AssetBond log. src: 0 depository, 1 RWA desk v2, 2 asset desk, 3 sleeve desk v3. */
export function decodeBond(log: Log): { src: 0 | 1 | 2 | 3; depositor: string; usdg: number | null; net: number; price: number }
/** The manager sleeve's NET flows, one row per transaction and kind. */
export function sleeveFlows(inLogs: Log[], outLogs: Log[], paidLogs: Log[]): Array<{ block: number; net: number; kind: 'buy' | 'desk' | 'other-in' | 'other-out'; usd: number }>
/** One desk inventory deposit; `minted` is 1 when `supply` ([block, delta NET]) has a same-block mint of the same amount. */
export function inventoryRow(log: Log, supply: Array<[number, number]>): { block: number; src: 1 | 2 | 3; net: number; minted: 0 | 1 }
