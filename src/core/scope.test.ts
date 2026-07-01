import { describe, it, expect } from 'vitest'
import { captureWindow, voltsAxisRange, measureTrace, SCOPE_H_DIVS } from './scope'

const Fs = 100000

function samples(n: number) {
  const t = new Float64Array(n)
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) { t[i] = i / Fs; x[i] = Math.sin((2 * Math.PI * 1000 * i) / Fs) }
  return { t, x }
}

// Ideal 50%-duty square, amplitude A, frequency f, sampled at Fs.
function square(n: number, A = 1, f = 1000) {
  const x = new Float64Array(n)
  for (let i = 0; i < n; i++) { x[i] = ((i * f) / Fs) % 1 < 0.5 ? A : -A }
  return x
}

describe('captureWindow', () => {
  it('captures a 10-div window at 1 ms/div (period of 1 kHz spans exactly one division)', () => {
    const s = samples(1600) // 16 ms capture
    const tr = captureWindow(s, Fs, 0.001) // 10 ms window
    expect(tr.t.length).toBe(1000)          // 10 ms * 100 kSa/s
    expect(tr.t[0]).toBe(0)
    expect(tr.t[tr.t.length - 1]).toBeCloseTo(0.00999, 6)
    // 1 kHz period = 1 ms = one division; window holds SCOPE_H_DIVS periods
    const windowSec = SCOPE_H_DIVS * 0.001
    expect(windowSec).toBeCloseTo(0.01, 9)
  })

  it('downsamples to <= maxPoints', () => {
    const s = samples(5000)
    const tr = captureWindow(s, Fs, 0.003) // 30 ms → 3000 samples, stride 2 → 1500 pts
    expect(tr.v.length).toBeLessThanOrEqual(2000)
    expect(tr.v.length).toBe(1500)
  })

  it('voltsAxisRange is symmetric ±(V_DIVS/2)*vpd', () => {
    expect(voltsAxisRange(0.5)).toEqual([-2, 2])
    expect(voltsAxisRange(1)).toEqual([-4, 4])
  })
})

describe('measureTrace', () => {
  it('measures a 1 kHz, 1 V sine (16 ms window)', () => {
    const s = samples(1600).x
    const m = measureTrace(s, 1 / Fs)
    expect(m.vmax).toBeCloseTo(1, 2)
    expect(m.vmin).toBeCloseTo(-1, 2)
    expect(m.vpp).toBeCloseTo(2, 2)
    expect(m.mean).toBeCloseTo(0, 3)
    expect(m.vrms).toBeCloseTo(Math.SQRT1_2, 2) // 0.707
    expect(m.freq).toBeCloseTo(1000, 0)
    expect(m.period).toBeCloseTo(0.001, 5)
    expect(m.duty).toBeCloseTo(0.5, 2)
  })

  it('measures a 1 kHz, 1 V, 50% square (10 ms window)', () => {
    const s = square(1000, 1, 1000) // exactly 10 periods
    const m = measureTrace(s, 1 / Fs)
    expect(m.vpp).toBeCloseTo(2, 6)
    expect(m.vrms).toBeCloseTo(1, 6)
    expect(m.mean).toBeCloseTo(0, 6)
    expect(m.freq).toBeCloseTo(1000, 0)
    expect(m.duty).toBeCloseTo(0.5, 2)
  })

  it('returns null timing for a flat/DC trace', () => {
    const s = new Float64Array(1000).fill(0.5)
    const m = measureTrace(s, 1 / Fs)
    expect(m.vpp).toBe(0)
    expect(m.mean).toBeCloseTo(0.5, 9)
    expect(m.freq).toBeNull()
    expect(m.period).toBeNull()
    expect(m.duty).toBeNull()
  })

  it('empty trace is safe', () => {
    const m = measureTrace(new Float64Array(0), 1 / Fs)
    expect(m.vpp).toBe(0)
    expect(m.freq).toBeNull()
  })
})

// FB-1: the scope now measures over the full captured record (≥ 1 cycle), not the visible graticule
// span. This test pins the reason: a sub-period window under-reports Vpp (Peggy's "Vpp reads half"),
// while the full multi-period record gives the true peak-to-peak. measureTrace's math is unchanged —
// the fix is the window the Oscilloscope feeds it.
describe('FB-1: measurement window must span ≥ 1 cycle for correct Vpp', () => {
  const A = 2 // amplitude 2 V → true Vpp = 4 V; 1 kHz at Fs=100k → 100 samples/period
  const sineA = (n: number) => {
    const x = new Float64Array(n)
    for (let i = 0; i < n; i++) x[i] = A * Math.sin((2 * Math.PI * 1000 * i) / Fs)
    return x
  }

  it('full multi-period record reports Vpp = 2A', () => {
    expect(measureTrace(sineA(1600), 1 / Fs).vpp).toBeCloseTo(2 * A, 2) // 4 V
  })

  it('a sub-period (quarter-cycle) window under-reports Vpp — the bug the full-record fix avoids', () => {
    const quarter = sineA(1600).subarray(0, 25) // 25 samples ≈ quarter period
    expect(measureTrace(quarter, 1 / Fs).vpp).toBeLessThan(2 * A - 0.5) // reads ~A, not 2A
  })
})
