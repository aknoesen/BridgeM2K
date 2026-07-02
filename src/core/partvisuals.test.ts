import { describe, it, expect } from 'vitest'
import { resistorBands, ledColor, ledBrightness, RES_COLORS, RES_GOLD } from './partvisuals'

const [BLACK, BROWN, RED, , YELLOW, , , VIOLET] = RES_COLORS

describe('resistorBands (ARB-1 colour code)', () => {
  it('reads standard kit values off the E-series code', () => {
    // 4.7 kΩ → yellow, violet, red (×100), gold
    expect(resistorBands(4700)).toEqual([YELLOW, VIOLET, RED, RES_GOLD])
    // 1 kΩ → brown, black, red (×100)
    expect(resistorBands(1000)).toEqual([BROWN, BLACK, RED, RES_GOLD])
    // 470 Ω → yellow, violet, brown (×10)
    expect(resistorBands(470)).toEqual([YELLOW, VIOLET, BROWN, RES_GOLD])
    // 100 Ω → brown, black, brown (×10)
    expect(resistorBands(100)).toEqual([BROWN, BLACK, BROWN, RES_GOLD])
    // 10 Ω → brown, black, black (×1)
    expect(resistorBands(10)).toEqual([BROWN, BLACK, BLACK, RES_GOLD])
    // 10 kΩ → brown, black, orange (×1000) — andre's screenshot value
    const ORANGE = RES_COLORS[3]
    expect(resistorBands(10000)).toEqual([BROWN, BLACK, ORANGE, RES_GOLD])
    // 2.2 kΩ → red, red, red (×100)
    expect(resistorBands(2200)).toEqual([RED, RED, RED, RES_GOLD])
  })

  it('always yields 4 bands for a positive value; none for non-positive', () => {
    expect(resistorBands(2200)).toHaveLength(4)
    expect(resistorBands(0)).toEqual([])
    expect(resistorBands(-5)).toEqual([])
    expect(resistorBands(NaN)).toEqual([])
  })
})

describe('ledColor (ARB-1 lens colour by Vf)', () => {
  it('maps forward voltage to a plausible lens colour', () => {
    expect(ledColor(1.8)).toBe('#ff4433') // red   (< 2.0)
    expect(ledColor(2.1)).toBe('#ffb020') // amber (2.0–2.4)
    expect(ledColor(2.5)).toBe('#33dd55') // green (2.4–2.9)
    expect(ledColor(3.0)).toBe('#4488ff') // blue  (≥ 2.9)
    expect(ledColor()).toBe('#ffb020')    // default ~2 V → amber
  })
})

describe('ledBrightness (ARB-2 log glow curve, 0.1–20 mA)', () => {
  it('is dark at/below the 0.1 mA floor and full at/above 20 mA', () => {
    expect(ledBrightness(0)).toBe(0)
    expect(ledBrightness(1e-4)).toBe(0)
    expect(ledBrightness(2e-2)).toBeCloseTo(1, 9)
    expect(ledBrightness(0.1)).toBe(1)
  })
  it('scales with log(I): 1 mA sits mid-dim, and 10 mA is brighter than 1 mA', () => {
    const at1mA = ledBrightness(1e-3)
    expect(at1mA).toBeCloseTo(Math.log10(10) / Math.log10(200), 6) // ≈ 0.43
    expect(ledBrightness(1e-2)).toBeGreaterThan(at1mA)
  })
})
