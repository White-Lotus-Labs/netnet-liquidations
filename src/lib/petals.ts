// Sakura field for the Canvas 2D petals, after Iroh's Tea Shop (src/ui/waiting-room/SakuraPetals.tsx).

export const PETALS_FULL = 40
export const PETALS_LIGHT = 16
/** Canvas pixels per CSS pixel, capped: soft petals do not need a 3x buffer. */
export const PETAL_DPR_CAP = 1.5

export type PetalEnv = { reducedMotion: boolean; saveData: boolean; coarse: boolean; narrow: boolean }

/** 40 on desktop, 16 on phones or save-data, none under reduced motion. */
export function petalCountFor(env: PetalEnv): number {
  if (env.reducedMotion) return 0
  if (env.saveData || env.coarse || env.narrow) return PETALS_LIGHT
  return PETALS_FULL
}

/** Mulberry32, as in the tea shop, so the field is the same on every visit. */
export function seeded(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `value` folded into [0, span). Negative values wrap too. */
export function wrap(value: number, span: number): number {
  const folded = value % span
  return folded < 0 ? folded + span : folded
}

/** Per-petal seeds, struct-of-arrays so the draw loop reads numbers and allocates nothing. */
export type PetalField = {
  count: number
  /** Start position as a share of the field, 0..1. */
  x: Float32Array
  y: Float32Array
  /** Depth, 0 far to 1 near. Sorted ascending so near petals draw last. */
  z: Float32Array
  /** Fall speed multiplier. */
  speed: Float32Array
  /** Phase for sway, tumble and spin. */
  phase: Float32Array
  /** Tumble rate, radians per second. */
  tumble: Float32Array
  /** Slow spin, radians per second, either way. */
  spin: Float32Array
  /** Size multiplier. */
  size: Float32Array
}

export const PETAL_SEED = 0x51a7d3

export function petalField(count: number, seed = PETAL_SEED): PetalField {
  const rand = seeded(seed)
  const range = (lo: number, hi: number) => lo + (hi - lo) * rand()
  const rows = Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    z: rand(),
    speed: range(0.8, 1.2),
    phase: rand() * Math.PI * 2,
    tumble: range(0.5, 1.7),
    spin: range(-0.35, 0.35),
    size: range(0.8, 1.2),
  }))
  rows.sort((a, b) => a.z - b.z)
  const field: PetalField = {
    count,
    x: new Float32Array(count),
    y: new Float32Array(count),
    z: new Float32Array(count),
    speed: new Float32Array(count),
    phase: new Float32Array(count),
    tumble: new Float32Array(count),
    spin: new Float32Array(count),
    size: new Float32Array(count),
  }
  rows.forEach((row, i) => {
    field.x[i] = row.x
    field.y[i] = row.y
    field.z[i] = row.z
    field.speed[i] = row.speed
    field.phase[i] = row.phase
    field.tumble[i] = row.tumble
    field.spin[i] = row.spin
    field.size[i] = row.size
  })
  return field
}

/** Dusk blush: rgb(0.70, 0.25, 0.40) at the base to rgb(0.93, 0.60, 0.70) toward the tip. */
export const PETAL_BASE: readonly [number, number, number] = [0.7, 0.25, 0.4]
export const PETAL_TIP: readonly [number, number, number] = [0.93, 0.6, 0.7]
/** Warm light from the doorway, on the petal's rim. */
export const PETAL_RIM: readonly [number, number, number] = [1, 0.56, 0.4]
/** Far petals sink into the dusk, near ones catch the light: colour x mix(0.5, 1, near). */
export const DEPTH_TIERS = [0.55, 0.7, 0.85, 1] as const

export function tierFor(z: number): number {
  return Math.min(DEPTH_TIERS.length - 1, Math.max(0, Math.floor(z * DEPTH_TIERS.length)))
}

export function petalRgb(color: readonly [number, number, number], dim: number): string {
  const [r, g, b] = color.map((c) => Math.round(Math.min(1, Math.max(0, c * dim)) * 255))
  return `rgb(${r} ${g} ${b})`
}
