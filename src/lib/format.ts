import { NET_DECIMALS, USDG_DECIMALS, WAD, WSNET_DECIMALS } from './units.ts'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function groupThousands(body: string): string {
  const [whole, frac] = body.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

/** Round a fixed-point integer to `digits` fractional places and group thousands. */
export function formatUnits(value: bigint, decimals: number, digits: number): string {
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const scale = 10n ** BigInt(digits)
  const rounded = (abs * scale + base / 2n) / base
  const whole = rounded / scale
  const frac = rounded % scale
  const body =
    digits === 0 ? whole.toString() : `${whole.toString()}.${frac.toString().padStart(digits, '0')}`
  return `${negative ? '-' : ''}${groupThousands(body)}`
}

export function formatUsdg(raw: bigint | null, digits = 0): string {
  if (raw === null) return '—'
  return formatUnits(raw, USDG_DECIMALS, digits)
}

export function formatWsNet(raw: bigint | null, digits = 2): string {
  if (raw === null) return '—'
  return formatUnits(raw, WSNET_DECIMALS, digits)
}

export function formatNet(raw: bigint | null, digits = 2): string {
  if (raw === null) return '—'
  return formatUnits(raw, NET_DECIMALS, digits)
}

export function formatWad(wad: bigint | null, digits = 2): string {
  if (wad === null) return '—'
  return formatUnits(wad, 18, digits)
}

export function formatPercentWad(wad: bigint | null, digits = 1): string {
  if (wad === null) return '—'
  const negative = wad < 0n
  const abs = negative ? -wad : wad
  const scale = 10n ** BigInt(digits)
  const pctScaled = (abs * 100n * scale + WAD / 2n) / WAD
  const whole = pctScaled / scale
  const frac = pctScaled % scale
  const body =
    digits === 0 ? whole.toString() : `${whole.toString()}.${frac.toString().padStart(digits, '0')}`
  return `${negative ? '-' : ''}${body}%`
}

export function formatHealth(healthWad: bigint | null): string {
  if (healthWad === null) return '—'
  const digits = healthWad < 10n * WAD ? 3 : 2
  return formatUnits(healthWad, 18, digits)
}

export function formatMultiple(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`
}

export function formatApy(apy: number | null): string {
  if (apy === null || !Number.isFinite(apy)) return '—'
  return `${(apy * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

export function formatRatio(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${(value * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

export function shortAddress(address: string): string {
  if (address.length < 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function formatWarsaw(ms: number): string {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms))
  return `${formatted} Europe/Warsaw`
}

export function formatAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  if (seconds < 10) return 'just now'
  if (seconds < 90) return `${Math.round(seconds)}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `${minutes}m ago`
  const hours = Math.floor(seconds / 3600)
  const remain = Math.round((seconds - hours * 3600) / 60)
  return `${hours}h ${remain}m ago`
}

export function formatDays(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return '—'
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`
  if (days < 10) return `${days.toFixed(1)}d`
  return `${Math.round(days)}d`
}

export function parseUsdgInput(input: string): bigint | null {
  const cleaned = input.replace(/,/g, '').trim()
  if (!/^\d+(\.\d{0,6})?$/.test(cleaned)) return null
  const [whole, frac = ''] = cleaned.split('.')
  const padded = `${frac}000000`.slice(0, 6)
  return BigInt(whole) * 1_000_000n + BigInt(padded)
}

/** Enough precision for chart coordinates and runway math. Not for token accounting. */
export function wadToNumber(wad: bigint): number {
  const negative = wad < 0n
  const abs = negative ? -wad : wad
  const whole = abs / WAD
  const frac9 = (abs % WAD) / 1_000_000_000n
  const value = Number(whole) + Number(frac9) / 1e9
  return negative ? -value : value
}
