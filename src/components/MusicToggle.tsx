import { useCallback, useEffect, useRef, useState } from 'react'
import { cx } from '../lib/format.ts'
import { backgroundMusicSources, loopBounds, readBackgroundMusic, writeBackgroundMusic } from '../lib/music.ts'

// Low: the desk is for reading.
const VOLUME = 0.35
// Time constant for gain changes, in seconds; a hard cut clicks.
const FADE = 0.35

type Player =
  | { kind: 'buffer'; context: AudioContext; gain: GainNode }
  | { kind: 'element'; element: HTMLAudioElement; ramp: number }

type AudioContextClass = typeof AudioContext

function audioContextClass(): AudioContextClass | null {
  if (typeof AudioContext === 'function') return AudioContext
  return (window as Window & { webkitAudioContext?: AudioContextClass }).webkitAudioContext ?? null
}

/**
 * Background music, as in Iroh's Tea Shop. On by default, but browsers hold
 * sound until a gesture, so it starts at the first click or key press
 * anywhere. Web Audio loops the buffer sample-exact; a plain <audio loop> is
 * the fallback. Nothing downloads before that gesture.
 */
export function MusicToggle({ className }: { className?: string }) {
  const player = useRef<Player | null>(null)
  const loading = useRef(false)
  const button = useRef<HTMLButtonElement>(null)
  const [on, setOn] = useState(readBackgroundMusic)
  const want = useRef(on)
  const [playing, setPlaying] = useState(false)

  const fade = useCallback(() => {
    const current = player.current
    if (!current) return
    const audible = want.current && !document.hidden
    if (current.kind === 'buffer') {
      const { context, gain } = current
      if (document.hidden) {
        void context.suspend()
        return
      }
      if (audible) void context.resume()
      gain.gain.setTargetAtTime(audible ? VOLUME : 0, context.currentTime, FADE)
      if (audible) return
      window.setTimeout(() => {
        if (!want.current) void context.suspend()
      }, FADE * 4000)
      return
    }
    // <audio> fallback: step the volume, then pause at silence.
    const { element } = current
    window.clearInterval(current.ramp)
    if (document.hidden) {
      element.pause()
      return
    }
    if (audible) element.play().catch(() => undefined)
    const target = audible ? VOLUME : 0
    current.ramp = window.setInterval(() => {
      const gap = target - element.volume
      const next = Math.abs(gap) <= 0.03 ? target : element.volume + Math.sign(gap) * 0.03
      element.volume = next
      if (next !== target) return
      window.clearInterval(current.ramp)
      if (!audible) element.pause()
    }, 50)
  }, [])

  const giveUp = useCallback(() => {
    loading.current = false
    want.current = false
    setOn(false)
  }, [])

  /** Plain <audio loop>: seeks back at the seam, so a small gap, but it plays everywhere. */
  const startElement = useCallback(
    (sources: string[]) => {
      const element = new Audio()
      element.loop = true
      element.preload = 'auto'
      element.volume = 0
      element.src = sources[0]
      let next = 1
      element.addEventListener('error', () => {
        // Try the next format; nothing left means the toggle shows off.
        if (next < sources.length) {
          element.src = sources[next++]
          if (want.current) element.play().catch(() => undefined)
          return
        }
        if (player.current?.kind === 'element') window.clearInterval(player.current.ramp)
        player.current = null
        setPlaying(false)
        giveUp()
      })
      player.current = { kind: 'element', element, ramp: 0 }
      loading.current = false
      setPlaying(true)
      fade()
    },
    [fade, giveUp],
  )

  // Must run inside a user gesture: that is what lets sound start.
  const start = useCallback(() => {
    if (!want.current) return
    if (player.current) return fade()
    if (loading.current) return
    loading.current = true
    const probe = document.createElement('audio')
    const sources = backgroundMusicSources((type) => probe.canPlayType(type))
    const Context = audioContextClass()
    if (!Context) return startElement(sources)
    let context: AudioContext
    try {
      context = new Context()
    } catch {
      return startElement(sources)
    }
    const gain = context.createGain()
    gain.gain.value = 0
    gain.connect(context.destination)
    void (async () => {
      for (const src of sources) {
        try {
          const response = await fetch(src)
          if (!response.ok) continue
          const buffer = await context.decodeAudioData(await response.arrayBuffer())
          const bounds = loopBounds(buffer.getChannelData(0), buffer.sampleRate)
          const source = context.createBufferSource()
          source.buffer = buffer
          source.loop = true
          // An all-quiet decode has no bounds; loop the whole buffer.
          if (bounds.end > bounds.start) {
            source.loopStart = bounds.start
            source.loopEnd = bounds.end
          }
          source.connect(gain)
          source.start(0, bounds.end > bounds.start ? bounds.start : 0)
          player.current = { kind: 'buffer', context, gain }
          loading.current = false
          setPlaying(true)
          return fade()
        } catch {
          /* Try the next format. */
        }
      }
      // Web Audio could not fetch or decode anything: fall back to the media element.
      void context.close()
      if (want.current) startElement(sources)
      else loading.current = false
    })()
  }, [fade, startElement])

  const setEnabled = useCallback(
    (next: boolean) => {
      want.current = next
      setOn(next)
      writeBackgroundMusic(next)
      if (next) start()
      else fade()
    },
    [fade, start],
  )

  // The first click or key anywhere starts it. The toggle's own click is its
  // own business. Once the music plays, stop listening.
  useEffect(() => {
    if (!on || playing) return
    const onGesture = (event: Event) => {
      if (event.target instanceof Node && button.current?.contains(event.target)) return
      start()
    }
    window.addEventListener('click', onGesture)
    window.addEventListener('keydown', onGesture)
    return () => {
      window.removeEventListener('click', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
  }, [on, playing, start])

  // Pause while the tab is hidden; fade back in when it returns.
  useEffect(() => {
    document.addEventListener('visibilitychange', fade)
    return () => document.removeEventListener('visibilitychange', fade)
  }, [fade])

  useEffect(
    () => () => {
      const current = player.current
      player.current = null
      if (current?.kind === 'buffer') void current.context.close()
      if (current?.kind === 'element') {
        window.clearInterval(current.ramp)
        current.element.pause()
        current.element.removeAttribute('src')
      }
    },
    [],
  )

  return (
    <button
      ref={button}
      type="button"
      className={cx(className, 'aria-pressed:border-[rgb(233_201_131/0.7)] aria-pressed:bg-[rgb(212_175_120/0.14)]')}
      aria-pressed={on}
      aria-label="Background music"
      title="Background music on/off"
      onClick={() => setEnabled(!on)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
        {!on && <path d="M3 3l18 18" />}
      </svg>
    </button>
  )
}
