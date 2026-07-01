import { describe, it, expect } from 'vitest'
import { tiaCompensation } from './tia'

describe('tiaCompensation (TIA-3 Cf helper)', () => {
  // BPW 34 CJO = 72 pF, Rf = 33 kΩ, TLV9062 GBW = 10 MHz.
  it('recommends Cf ≈ √(Cin/(2π·Rf·GBW)) and the matching bandwidth', () => {
    const r = tiaCompensation(72e-12, 33000, 10e6)
    const expectedCf = Math.sqrt(72e-12 / (2 * Math.PI * 33000 * 10e6))
    expect(r.cfRecommended).toBeCloseTo(expectedCf, 15)
    expect(r.cfRecommended * 1e12).toBeCloseTo(5.89, 1) // ≈ 5.9 pF
    // bandwidth = 1/(2π·Rf·Cf) = √(GBW/(2π·Rf·Cin))
    expect(r.bandwidthHz).toBeCloseTo(Math.sqrt(10e6 / (2 * Math.PI * 33000 * 72e-12)), -2)
    expect(r.bandwidthHz).toBeGreaterThan(700000)
    expect(r.bandwidthHz).toBeLessThan(950000)
  })

  it('flags peaking when Cf is absent or below the recommended value; clears it when ample', () => {
    expect(tiaCompensation(72e-12, 33000, 10e6).peaking).toBe(true)          // no Cf → peaking
    expect(tiaCompensation(72e-12, 33000, 10e6, 2e-12).peaking).toBe(true)   // 2 pF < ~5.9 pF → peaking
    expect(tiaCompensation(72e-12, 33000, 10e6, 1e-9).peaking).toBe(false)   // 1 nF ≫ 5.9 pF → stable
  })

  it('is robust to non-positive inputs (returns peaking, no NaN blow-up)', () => {
    const r = tiaCompensation(0, 0, 0)
    expect(r.cfRecommended).toBe(0)
    expect(r.bandwidthHz).toBe(0)
    expect(r.peaking).toBe(true)
  })

  it('a bigger Rf lowers both the recommended Cf and the bandwidth', () => {
    const lo = tiaCompensation(72e-12, 10000, 10e6)
    const hi = tiaCompensation(72e-12, 100000, 10e6)
    expect(hi.cfRecommended).toBeLessThan(lo.cfRecommended)
    expect(hi.bandwidthHz).toBeLessThan(lo.bandwidthHz)
  })
})
