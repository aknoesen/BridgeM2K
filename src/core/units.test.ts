import { describe, it, expect } from 'vitest'
import { parseEng, fmtEng, tunePos, tuneValue, TUNE_RANGE } from './units'

describe('engineering notation', () => {
  it('parses prefixes', () => {
    expect(parseEng('1k')).toBeCloseTo(1000, 9)
    expect(parseEng('159n')).toBeCloseTo(159e-9, 18)
    expect(parseEng('4.7u')).toBeCloseTo(4.7e-6, 18)
    expect(parseEng('100')).toBeCloseTo(100, 9)
    expect(parseEng('garbage')).toBeUndefined()
  })

  it('formats with prefixes', () => {
    expect(fmtEng(1000)).toBe('1k')
    expect(fmtEng(100e-9)).toBe('100n')
    expect(fmtEng(0)).toBe('0')
  })
})

describe('tune slider mapping', () => {
  it('round-trips position ↔ value within one step', () => {
    const [lo, hi] = TUNE_RANGE.capacitor!
    for (const v of [1e-12, 1e-9, 100e-9, 1e-6, 1e-5]) {
      const back = tuneValue(tunePos(v, lo, hi), lo, hi)
      expect(Math.abs(Math.log10(back / v))).toBeLessThan(0.01) // <1% in log space
    }
  })

  it('clamps out-of-range values to the slider ends', () => {
    const [lo, hi] = TUNE_RANGE.resistor!
    expect(tunePos(lo / 100, lo, hi)).toBe(0)
    expect(tunePos(hi * 100, lo, hi)).toBe(1000)
  })

  it('is monotonic: a higher position gives a larger value', () => {
    const [lo, hi] = TUNE_RANGE.inductor!
    expect(tuneValue(600, lo, hi)).toBeGreaterThan(tuneValue(400, lo, hi))
  })
})
