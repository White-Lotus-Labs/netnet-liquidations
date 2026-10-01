import { useEffect, useRef, useState } from 'react'
import {
  DEPTH_TIERS,
  PETAL_BASE,
  PETAL_DPR_CAP,
  PETAL_RIM,
  PETAL_TIP,
  petalCountFor,
  petalField,
  petalRgb,
  tierFor,
  wrap,
} from '../lib/petals.ts'

const REDUCED = '(prefers-reduced-motion: reduce)'
const COARSE = '(pointer: coarse)'
const NARROW = '(max-width: 639.98px)'
// Petals wrap this far outside the view so they never pop at an edge:
// widest sway (26 x 1.15) plus the largest petal's reach (about 26 px).
const MARGIN = 56
// A long frame (tab switch, GC) must not throw the field forward.
const MAX_DT = 0.05
// A still frame to start from: petals mid-fall, not stacked at spawn.
const START_T = 18

function readCount(): number {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  return petalCountFor({
    reducedMotion: matchMedia(REDUCED).matches,
    saveData: nav.connection?.saveData === true,
    coarse: matchMedia(COARSE).matches,
    narrow: matchMedia(NARROW).matches,
  })
}

/** Petal budget for this device. Starts at 0 and turns on after the page settles. */
function usePetalCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let started = false
    const sync = () => {
      if (started) setCount(readCount())
    }
    const start = () => {
      started = true
      sync()
    }
    const queries = [REDUCED, COARSE, NARROW].map((query) => matchMedia(query))
    for (const query of queries) query.addEventListener('change', sync)
    let cancel: () => void
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(start, { timeout: 1800 })
      cancel = () => window.cancelIdleCallback(id)
    } else {
      const timer = window.setTimeout(start, 700)
      cancel = () => window.clearTimeout(timer)
    }
    return () => {
      cancel()
      for (const query of queries) query.removeEventListener('change', sync)
    }
  }, [])
  return count
}

/**
 * The tea shop's cupped, notched petal in a unit box: base at y = -0.5, the
 * notched tip at y = +0.5, about 0.84 wide.
 */
function petalPath(): Path2D {
  const path = new Path2D()
  path.moveTo(0, -0.5)
  path.bezierCurveTo(0.2, -0.42, 0.44, -0.12, 0.42, 0.18)
  path.bezierCurveTo(0.41, 0.38, 0.3, 0.5, 0.17, 0.5)
  path.quadraticCurveTo(0.06, 0.5, 0, 0.33)
  path.quadraticCurveTo(-0.06, 0.5, -0.17, 0.5)
  path.bezierCurveTo(-0.3, 0.5, -0.41, 0.38, -0.42, 0.18)
  path.bezierCurveTo(-0.44, -0.12, -0.2, -0.42, 0, -0.5)
  path.closePath()
  return path
}

/** One base-to-tip gradient per depth tier, in petal space, reused for every petal. */
function petalGradients(ctx: CanvasRenderingContext2D): CanvasGradient[] {
  return DEPTH_TIERS.map((dim) => {
    const gradient = ctx.createLinearGradient(0, -0.5, 0, 0.5)
    // smoothstep(0, 0.8) along the petal, sampled.
    gradient.addColorStop(0, petalRgb(PETAL_BASE, dim))
    gradient.addColorStop(0.4, petalRgb(mix(PETAL_BASE, PETAL_TIP, 0.5), dim))
    gradient.addColorStop(0.8, petalRgb(PETAL_TIP, dim))
    gradient.addColorStop(1, petalRgb(PETAL_TIP, dim))
    return gradient
  })
}

function mix(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/**
 * Sakura adrift over the tea shop photo and behind the paper sheet. Canvas 2D:
 * each petal falls, sways, and tumbles (one axis scaled by cos of its turn,
 * plus a slow spin). Nothing renders under reduced motion.
 */
export function Petals() {
  const count = usePetalCount()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || count === 0) return
    const field = petalField(count)
    const path = petalPath()
    const gradients = petalGradients(ctx)
    const rim = petalRgb(PETAL_RIM, 1)
    let width = 0
    let height = 0
    let dpr = 1
    let scale = 1
    let frame = 0
    let last = 0
    let t = START_T

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, PETAL_DPR_CAP)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      // Petals a touch smaller on a phone, a touch larger on a wide screen.
      scale = Math.min(1.15, Math.max(0.75, Math.min(width, height) / 820))
      // Resizing resets the context state.
      ctx.strokeStyle = rim
      ctx.lineJoin = 'round'
    }

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const spanX = width + MARGIN * 2
      const spanY = height + MARGIN * 2
      for (let i = 0; i < field.count; i++) {
        const z = field.z[i]
        const phase = field.phase[i]
        const fall = t * (18 + 30 * z) * field.speed[i] * scale
        const sway = Math.sin(t * 0.9 + phase) * (10 + 16 * z) * scale
        const x = wrap(field.x[i] * spanX + fall * 0.34, spanX) - MARGIN + sway
        const y = wrap(field.y[i] * spanY + fall, spanY) - MARGIN
        const size = (9 + 12 * z) * field.size[i] * scale
        // Tumble: the petal turns about its long axis, so its width goes as cos.
        const turn = t * field.tumble[i] + phase
        const cosTurn = Math.cos(turn)
        const across = (Math.abs(cosTurn) < 0.12 ? (cosTurn < 0 ? -0.12 : 0.12) : cosTurn) * size
        const along = (0.85 + 0.15 * Math.sin(turn * 0.7 + phase)) * size
        const angle = phase + t * field.spin[i] + Math.sin(t * 0.9 + phase) * 0.35
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        ctx.setTransform(dpr * cos * across, dpr * sin * across, -dpr * sin * along, dpr * cos * along, dpr * x, dpr * y)
        // Underside faces away from the doorway light: one tier darker.
        const tier = tierFor(z)
        ctx.fillStyle = gradients[cosTurn < 0 && tier > 0 ? tier - 1 : tier]
        ctx.globalAlpha = 0.45 + 0.5 * z
        ctx.fill(path)
        // Warm rim, strongest when the petal is backlit (edge-on to us).
        ctx.globalAlpha = (0.12 + 0.28 * (1 - Math.abs(cosTurn))) * (0.5 + 0.5 * z)
        ctx.lineWidth = 0.06
        ctx.stroke(path)
      }
      ctx.globalAlpha = 1
    }

    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, MAX_DT) : 0
      last = now
      t += dt
      draw()
      frame = window.requestAnimationFrame(tick)
    }

    const play = () => {
      if (frame || document.hidden) return
      last = 0
      frame = window.requestAnimationFrame(tick)
    }
    const stop = () => {
      window.cancelAnimationFrame(frame)
      frame = 0
    }
    const onVisibility = () => (document.hidden ? stop() : play())

    resize()
    draw()
    play()
    window.addEventListener('resize', resize, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [count])

  if (count === 0) return null
  return <canvas ref={canvasRef} className="petals" aria-hidden="true" />
}
