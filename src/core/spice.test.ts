import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { normalizeResult, transferFunction, findCutoffHz, analyzeBode } from './spice'
import { buildNetlist, type Circuit } from './netlist'

const rc: Circuit = {
  title: 'RC low-pass (NET-1 transferFunction test)',
  components: [
    { kind: 'vsource', id: '1', nodes: ['in', '0'], dc: 0, acMag: 1 },
    { kind: 'resistor', id: '1', nodes: ['in', 'out'], ohms: 1000 },
    { kind: 'capacitor', id: '1', nodes: ['out', '0'], farads: 159.155e-9 },
    { kind: 'ground', id: '0', node: '0' },
  ],
}

function lerpAt(freq: Float64Array, y: Float64Array, target: number): number {
  for (let i = 1; i < freq.length; i++) {
    if (freq[i - 1] <= target && freq[i] >= target) {
      const t = (target - freq[i - 1]) / (freq[i] - freq[i - 1])
      return y[i - 1] + t * (y[i] - y[i - 1])
    }
  }
  return NaN
}

describe('transferFunction (Bode)', () => {
  it('RC low-pass: 0 dB passband, -3 dB at ~1 kHz, -45° phase at cutoff', async () => {
    const nl = buildNetlist(rc, { kind: 'ac', sweep: 'dec', points: 100, fStart: 10, fStop: 1e6 })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const r = transferFunction(normalizeResult(await sim.runSim()), 'out', 'in')

    expect(r.magDb[0]).toBeGreaterThan(-0.2) // flat passband near 0 dB

    // -3 dB cutoff
    let cutoff = NaN
    for (let i = 1; i < r.magDb.length; i++) {
      if (r.magDb[i - 1] >= -3 && r.magDb[i] < -3) { cutoff = r.freq[i]; break }
    }
    expect(cutoff).toBeGreaterThan(950)
    expect(cutoff).toBeLessThan(1050)

    // phase at 1 kHz ≈ -45°
    const phaseAt1k = lerpAt(r.freq, r.phaseDeg, 1000)
    expect(phaseAt1k).toBeGreaterThan(-50)
    expect(phaseAt1k).toBeLessThan(-40)
  }, 30000)
})

import { nodeVoltage, hasNode, differentialVoltage } from './spice'
import { buildNetlist as buildNl } from './netlist'
import type { Circuit as Ckt } from './netlist'

describe('node voltage (.op) for the Voltmeter', () => {
  it('reads DC node voltages and a differential', async () => {
    // V1 in 0 DC 5 ; R1 in->out 1k ; R2 out->0 1k  → V(out)=2.5
    const ckt: Ckt = {
      title: 'divider',
      components: [
        { kind: 'vsource', id: '1', nodes: ['in', '0'], dc: 5 },
        { kind: 'resistor', id: '1', nodes: ['in', 'out'], ohms: 1000 },
        { kind: 'resistor', id: '2', nodes: ['out', '0'], ohms: 1000 },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
    const nl = buildNl(ckt, { kind: 'op' })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const r = normalizeResult(await sim.runSim())
    expect(nodeVoltage(r, 'out')).toBeCloseTo(2.5, 3)
    expect(nodeVoltage(r, 'in')).toBeCloseTo(5, 3)
    expect(nodeVoltage(r, '0')).toBe(0)
    expect(hasNode(r, 'out')).toBe(true)
    expect(hasNode(r, 'nope')).toBe(false)
    expect(differentialVoltage(r, 'in', 'out')).toBeCloseTo(2.5, 3)
  }, 30000)
})

import { applySupplyRails } from './netlist'

describe('power supply rails (PSU-1)', () => {
  it('overrides a V+ rail and the voltmeter reads it', async () => {
    const ckt = {
      title: 'rail',
      components: [
        { kind: 'dcrail' as const, id: 'S1', node: 'out', volts: 5 },
        { kind: 'resistor' as const, id: '1', nodes: ['out', '0'] as [string, string], ohms: 1000 },
        { kind: 'ground' as const, id: '0', node: '0' },
      ],
    }
    const withRails = applySupplyRails(ckt, { plus: 3, minus: -5, plusEnabled: true, minusEnabled: true })
    const nl = buildNl(withRails, { kind: 'op' })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const r = normalizeResult(await sim.runSim())
    expect(nodeVoltage(r, 'out')).toBeCloseTo(3, 3)
  }, 30000)
})

describe('instrumentation amplifier', () => {
  // inP = diff, inN = 0, ref = 0  → V(out) = gain·diff
  function inampCircuit(model: 'ideal' | 'threeopamp', diff: number, gain: number): Ckt {
    return {
      title: `inamp ${model}`,
      components: [
        { kind: 'vsource', id: '1', nodes: ['inp', '0'], dc: diff },
        { kind: 'vsource', id: '2', nodes: ['inn', '0'], dc: 0 },
        { kind: 'inamp', id: '1', model, nodes: { inP: 'inp', inN: 'inn', out: 'out', ref: '0' }, gain },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
  }

  it('ideal in-amp: out = gain·(inP − inN)', async () => {
    const nl = buildNl(inampCircuit('ideal', 0.1, 10), { kind: 'op' })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const r = normalizeResult(await sim.runSim())
    expect(nodeVoltage(r, 'out')).toBeCloseTo(1.0, 3)
  }, 30000)

  it('3-op-amp in-amp: gain follows G = 1 + 2R/Rg', async () => {
    const nl = buildNl(inampCircuit('threeopamp', 0.05, 10), { kind: 'op' })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const r = normalizeResult(await sim.runSim())
    expect(nodeVoltage(r, 'out')).toBeCloseTo(0.5, 2)
  }, 30000)
})

import { sampleNodeTransient } from './spice'

describe('transient drive + resample (WIRE-3)', () => {
  it('square wave emits a PULSE source line, not SIN', () => {
    const ckt: Ckt = {
      title: 'sq',
      components: [
        { kind: 'vsource', id: 'W1', nodes: ['in', '0'], wave: { type: 'square', offset: 0, amplitude: 1, freq: 1000, duty: 50 } },
        { kind: 'resistor', id: '1', nodes: ['in', 'out'], ohms: 1000 },
        { kind: 'capacitor', id: '1', nodes: ['out', '0'], farads: 159.155e-9 },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
    const nl = buildNl(ckt, { kind: 'tran', step: 1e-6, stop: 2e-3 })
    expect(nl).toContain('PULSE(')
    expect(nl).not.toContain('SIN(')
  })

  // RC low-pass (1k, 159nF) → fc ≈ 1 kHz. Drive sine, measure steady-state peak-to-peak of
  // v(out) via the transient resampler.
  async function outPP(freq: number): Promise<number> {
    const ckt: Ckt = {
      title: 'rc tran',
      components: [
        { kind: 'vsource', id: 'W1', nodes: ['in', '0'], wave: { type: 'sine', offset: 0, amplitude: 1, freq, duty: 50 } },
        { kind: 'resistor', id: '1', nodes: ['in', 'out'], ohms: 1000 },
        { kind: 'capacitor', id: '1', nodes: ['out', '0'], farads: 159.155e-9 },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
    const T = 1 / freq
    const stop = 6 * T
    const nl = buildNl(ckt, { kind: 'tran', step: T / 200, stop })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const r = normalizeResult(await sim.runSim())
    const N = 400
    const grid = new Float64Array(N)
    for (let k = 0; k < N; k++) grid[k] = stop - 2 * T + (k / (N - 1)) * (2 * T)
    const x = sampleNodeTransient(r, 'out', grid)!
    let mn = Infinity, mx = -Infinity
    for (const v of x) { if (v < mn) mn = v; if (v > mx) mx = v }
    return mx - mn
  }

  it('RC low-pass: passband ≈ unity, stopband attenuated', async () => {
    const passPP = await outPP(100)    // well below fc → ~2 Vpp
    const stopPP = await outPP(10000)  // well above fc → strongly attenuated
    expect(passPP).toBeGreaterThan(1.6)
    expect(stopPP).toBeLessThan(0.6)
    expect(stopPP).toBeLessThan(passPP)
  }, 30000)
})

import { sourceCurrent } from './spice'

describe('supply current (PSU-2)', () => {
  it('reads the current a rail delivers to a load (5 V / 1 k = 5 mA)', async () => {
    const ckt: Ckt = {
      title: 'rail load',
      components: [
        { kind: 'dcrail', id: 'S1', node: 'out', volts: 5 },
        { kind: 'resistor', id: '1', nodes: ['out', '0'], ohms: 1000 },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(buildNl(ckt, { kind: 'op' }))
    const r = normalizeResult(await sim.runSim())
    expect(sourceCurrent(r, 'S1')).toBeCloseTo(0.005, 4)
  }, 30000)
})

describe('findCutoffHz (LOOP-2 -3 dB cursor)', () => {
  // Synthetic single-pole low-pass magnitude: |H| = 1/sqrt(1+(f/fc)^2) → -3.01 dB at f=fc.
  function onePole(fc: number, fStart = 10, fStop = 1e6, ptsPerDec = 20) {
    const decades = Math.log10(fStop / fStart)
    const n = Math.round(decades * ptsPerDec) + 1
    const freq = new Float64Array(n)
    const magDb = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const f = fStart * Math.pow(10, (i / (n - 1)) * decades)
      freq[i] = f
      magDb[i] = -10 * Math.log10(1 + (f / fc) * (f / fc))
    }
    return { freq, magDb }
  }

  it('interpolates the cutoff to within 1% for several fc', () => {
    for (const fc of [100, 1000, 15915, 100000]) {
      const { freq, magDb } = onePole(fc)
      const got = findCutoffHz(freq, magDb)
      expect(got).not.toBeNull()
      expect(Math.abs(got! - fc) / fc).toBeLessThan(0.01)
    }
  })

  it('beats nearest-grid-point accuracy (interpolation matters at coarse pts/decade)', () => {
    const fc = 2371 // deliberately between grid points at 5 pts/decade
    const { freq, magDb } = onePole(fc, 10, 1e6, 5) // coarse: ~5 pts/decade
    const interp = findCutoffHz(freq, magDb)!
    // nearest grid point that first crosses -3 dB
    let grid = NaN
    const target = magDb[0] - 3
    for (let i = 1; i < magDb.length; i++) if (magDb[i - 1] >= target && magDb[i] < target) { grid = freq[i]; break }
    expect(Math.abs(interp - fc)).toBeLessThan(Math.abs(grid - fc))
  })

  it('returns null when the response never drops 3 dB (flat trace)', () => {
    const freq = new Float64Array([10, 100, 1000, 10000])
    const magDb = new Float64Array([0, 0, 0, 0])
    expect(findCutoffHz(freq, magDb)).toBeNull()
  })
})

describe('analyzeBode (general -3 dB feature)', () => {
  // log-spaced magnitude sampler
  function sample(fn: (f: number) => number, fStart = 10, fStop = 1e6, ptsPerDec = 100) {
    const decades = Math.log10(fStop / fStart)
    const n = Math.round(decades * ptsPerDec) + 1
    const freq = new Float64Array(n)
    const magDb = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const f = fStart * Math.pow(10, (i / (n - 1)) * decades)
      freq[i] = f
      magDb[i] = fn(f)
    }
    return { freq, magDb }
  }
  const lp = (fc: number) => (f: number) => -10 * Math.log10(1 + (f / fc) ** 2)
  const hp = (fc: number) => (f: number) => -10 * Math.log10(1 + (fc / f) ** 2)
  const bp = (f0: number, Q: number) => (f: number) => -10 * Math.log10(1 + (Q * (f / f0 - f0 / f)) ** 2)
  const notch = (f0: number, Q: number) => (f: number) => -10 * Math.log10(1 + 1 / (Q * (f / f0 - f0 / f)) ** 2)

  it('classifies a low-pass and reads fc', () => {
    const { freq, magDb } = sample(lp(1000))
    const r = analyzeBode(freq, magDb)
    expect(r.shape).toBe('lowpass')
    expect(Math.abs(r.cutoffs[0] - 1000) / 1000).toBeLessThan(0.02)
  })

  it('classifies a high-pass and reads fc', () => {
    const { freq, magDb } = sample(hp(1000))
    const r = analyzeBode(freq, magDb)
    expect(r.shape).toBe('highpass')
    expect(Math.abs(r.cutoffs[0] - 1000) / 1000).toBeLessThan(0.02)
  })

  it('classifies a band-pass with center ≈ f0 and two edges', () => {
    const { freq, magDb } = sample(bp(1000, 5))
    const r = analyzeBode(freq, magDb)
    expect(r.shape).toBe('bandpass')
    expect(r.cutoffs.length).toBe(2)
    expect(Math.abs(r.center! - 1000) / 1000).toBeLessThan(0.03)
    expect(r.bandwidth!).toBeGreaterThan(150)
    expect(r.bandwidth!).toBeLessThan(260)
  })

  it('classifies a notch (band-stop) around f0', () => {
    const { freq, magDb } = sample(notch(1000, 5))
    const r = analyzeBode(freq, magDb)
    expect(r.shape).toBe('bandstop')
    expect(Math.abs(r.center! - 1000) / 1000).toBeLessThan(0.05)
  })

  it('reports flat / all-pass when nothing drops 3 dB', () => {
    const { freq, magDb } = sample(() => 0)
    expect(analyzeBode(freq, magDb).shape).toBe('flat')
  })
})
