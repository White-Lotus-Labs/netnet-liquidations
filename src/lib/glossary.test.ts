import { describe, expect, it } from 'vitest'
import { GLOSSARY } from './glossary.ts'

const HOSTS = new Set(['docs.netnet.capital', 'docs.morpho.org', 'docs.nansen.ai', 'docs.pendle.finance', 'app.netnet.capital'])
const BANNED = /\b(delve\w*|crucial|robust|seamless\w*|leverag\w*|utiliz(e|es|ed|ing)|pivotal|moreover|furthermore)\b|important to note|—/i
const entries = Object.entries(GLOSSARY)

describe('glossary', () => {
  it('has a term and short text for every entry', () => {
    expect(entries.length).toBeGreaterThan(40)
    for (const [id, entry] of entries) {
      expect(entry.term.trim(), id).not.toBe('')
      expect(entry.text.trim(), id).not.toBe('')
      expect(entry.text.length, id).toBeLessThanOrEqual(300)
    }
  })

  it('links only to https docs hosts', () => {
    for (const [id, { doc }] of entries) {
      if (!doc) continue
      const url = new URL(doc.href)
      expect(url.protocol, id).toBe('https:')
      expect(HOSTS.has(url.hostname), `${id}: ${url.hostname}`).toBe(true)
      expect(doc.label, id).toMatch(/\S ↗$/)
    }
  })

  it('avoids filler words and em dashes', () => {
    for (const [id, entry] of entries) {
      expect(`${entry.term} ${entry.text} ${entry.doc?.label ?? ''}`, id).not.toMatch(BANNED)
    }
  })
})
