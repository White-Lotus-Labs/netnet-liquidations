import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_MUSIC,
  BACKGROUND_MUSIC_KEY,
  backgroundMusicSources,
  loopBounds,
  readBackgroundMusic,
  writeBackgroundMusic,
} from './music.ts'

function memory() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

describe('background music preference', () => {
  it('is on until the reader turns it off', () => {
    const storage = memory()
    expect(BACKGROUND_MUSIC_KEY).toBe('net-desk-background-music')
    expect(readBackgroundMusic(storage)).toBe(true)
    writeBackgroundMusic(false, storage)
    expect(storage.getItem(BACKGROUND_MUSIC_KEY)).toBe('off')
    expect(readBackgroundMusic(storage)).toBe(false)
    writeBackgroundMusic(true, storage)
    expect(storage.getItem(BACKGROUND_MUSIC_KEY)).toBe('on')
    expect(readBackgroundMusic(storage)).toBe(true)
  })

  it('ignores storage that throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readBackgroundMusic(storage)).toBe(true)
    expect(() => writeBackgroundMusic(false, storage)).not.toThrow()
  })

  it('falls back to on when there is no localStorage at all', () => {
    // Node has no window storage here; the default read must not throw.
    expect(() => readBackgroundMusic()).not.toThrow()
    expect(() => writeBackgroundMusic(true)).not.toThrow()
  })
})

describe('background music file', () => {
  it('ships every source', () => {
    // Lazy glob: lists the files without loading them.
    const shipped = Object.keys(import.meta.glob('../../public/audio/*')).map((path) => path.replace('../../public', ''))
    for (const { src } of BACKGROUND_MUSIC) expect(shipped, src).toContain(src)
  })

  it('prefers Opus and keeps MP3 as the fallback', () => {
    const [opus, mp3] = BACKGROUND_MUSIC.map(({ src }) => src)
    expect(opus).toMatch(/\.webm$/)
    expect(mp3).toMatch(/\.mp3$/)
    expect(backgroundMusicSources(() => 'probably')).toEqual([opus, mp3])
    expect(backgroundMusicSources((type) => (type.includes('opus') ? '' : 'maybe'))).toEqual([mp3])
    expect(backgroundMusicSources(() => '')).toEqual([mp3])
  })

  it('loops past decoder padding at both ends', () => {
    const samples = new Float32Array([0, 0, 0.2, -0.1, 0.3, 0.00001, 0])
    expect(loopBounds(samples, 1)).toEqual({ start: 2, end: 5 })
    expect(loopBounds(new Float32Array([0.5, 0.5]), 2)).toEqual({ start: 0, end: 1 })
    expect(loopBounds(new Float32Array([0, 0, 0]), 1)).toEqual({ start: 3, end: 3 })
  })
})
