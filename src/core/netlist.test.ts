import { describe, it, expect } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { buildNetlist, makeInputSource, TRANSISTOR_PARTS, type Circuit } from './netlist'
import { normalizeResult, nodeVoltage } from './spice'

// RC low-pass: fc = 1/(2*pi*R*C) = 1/(2*pi*1k*159.155n) ≈ 1000 Hz.
const rc: Circuit = {
  title: 'RC low-pass (SPICE-2 test)',
  components: [
    { kind: 'vsource', id: '1', nodes: ['in', '0'], dc: 0, acMag: 1 },
    { kind: 'resistor', id: '1', nodes: ['in', 'out'], ohms: 1000 },
    { kind: 'capacitor', id: '1', nodes: ['out', '0'], farads: 159.155e-9 },
    { kind: 'ground', id: '0', node: '0' },
  ],
}

type Complex = { real: number; img: number }

describe('buildNetlist', () => {
  it('emits the expected RC .ac netlist', () => {
    const nl = buildNetlist(rc, { kind: 'ac', sweep: 'dec', points: 20, fStart: 10, fStop: 1e6 })
    expect(nl).toContain('V1 in 0 DC 0 AC 1')
    expect(nl).toContain('R1 in out 1000')
    expect(nl).toContain('C1 out 0 1.59155e-7')
    expect(nl).toContain('.ac dec 20 10 1000000')
    expect(nl.trimEnd().endsWith('.end')).toBe(true)
  })

  it('normalises ground aliases and emits .op / .tran directives', () => {
    const g: Circuit = {
      title: 't',
      components: [
        { kind: 'resistor', id: '1', nodes: ['a', 'gnd'], ohms: 10 },
        { kind: 'ground', id: '0', node: 'gnd' },
      ],
    }
    expect(buildNetlist(g, { kind: 'op' })).toContain('R1 a 0 10')
    expect(buildNetlist(g, { kind: 'op' })).toContain('.op')
    const tnl = buildNetlist(
      { title: 't', components: [makeInputSource('1', 'in', '0', {
        waveType: 'sine', frequency: 1000, amplitude: 1, offset: 0, dutyCycle: 50,
        samplingRate: 100000, duration: 0.016,
      })] },
      { kind: 'tran', step: 1e-5, stop: 1e-2 },
    )
    expect(tnl).toContain('SIN(0 1 1000)')
    expect(tnl).toContain('.tran 0.00001 0.01')
  })

  it('simulates to a -3 dB cutoff near 1000 Hz', async () => {
    const nl = buildNetlist(rc, { kind: 'ac', sweep: 'dec', points: 50, fStart: 10, fStop: 1e6 })
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(nl)
    const r = await sim.runSim()
    const fi = r.variableNames.findIndex((nm) => nm.toLowerCase() === 'frequency')
    const oi = r.variableNames.findIndex((nm) => nm.toLowerCase().includes('out'))
    const fvals = r.data[fi].values as Complex[]
    const ovals = r.data[oi].values as Complex[]
    const db = ovals.map((c) => 20 * Math.log10(Math.hypot(c.real, c.img)))
    let cutoff: number | null = null
    for (let i = 1; i < db.length; i++) {
      if (db[i - 1] >= -3 && db[i] < -3) {
        cutoff = fvals[i].real
        break
      }
    }
    expect(db[0]).toBeGreaterThan(-0.5) // flat passband
    expect(cutoff).not.toBeNull()
    expect(cutoff as number).toBeGreaterThan(900)
    expect(cutoff as number).toBeLessThan(1100)
  }, 30000)
})

describe('transistors (SCH-8)', () => {
  it('emits a BJT Q line + NPN .model card with the part body', () => {
    const c: Circuit = { title: 't', components: [
      { kind: 'bjt', id: '1', nodes: ['c', 'b', 'e'], polarity: 'npn', model: TRANSISTOR_PARTS['2N3904'].model },
      { kind: 'ground', id: '0', node: '0' },
    ] }
    const nl = buildNetlist(c, { kind: 'op' })
    expect(nl).toContain('Q1 c b e QM1')          // collector base emitter <model>
    expect(nl).toMatch(/\.model QM1 NPN\(.*BF=300.*\)/)
  })

  it('emits a PNP .model for a pnp part, and a generic body when none given', () => {
    const c: Circuit = { title: 't', components: [
      { kind: 'bjt', id: '2', nodes: ['c', 'b', 'e'], polarity: 'pnp' },
      { kind: 'ground', id: '0', node: '0' },
    ] }
    expect(buildNetlist(c, { kind: 'op' })).toMatch(/\.model QM2 PNP\(BF=100/)
  })

  it('emits a MOSFET M line with bulk tied to source + an NMOS .model', () => {
    const c: Circuit = { title: 't', components: [
      { kind: 'mosfet', id: '1', nodes: ['d', 'g', 's'], channel: 'nmos', model: TRANSISTOR_PARTS['ZVN2110A'].model },
      { kind: 'ground', id: '0', node: '0' },
    ] }
    const nl = buildNetlist(c, { kind: 'op' })
    expect(nl).toContain('M1 d g s s MM1')        // drain gate source bulk(=source) <model>
    expect(nl).toMatch(/\.model MM1 NMOS\(.*VTO=1\.5.*\)/)
  })

  it('ngspice accepts the transistor model cards (an NMOS .op solves)', async () => {
    // Gate at +5 V (on); drain fed from +5 V through 1k; source to ground.
    const c: Circuit = { title: 'nmos op', components: [
      { kind: 'dcrail', id: 'g', node: 'gate', volts: 5 },
      { kind: 'dcrail', id: 'd', node: 'vdd', volts: 5 },
      { kind: 'resistor', id: '1', nodes: ['vdd', 'drain'], ohms: 1000 },
      { kind: 'mosfet', id: '1', nodes: ['drain', 'gate', '0'], channel: 'nmos', model: TRANSISTOR_PARTS['ZVN2110A'].model },
      { kind: 'ground', id: '0', node: '0' },
    ] }
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(buildNetlist(c, { kind: 'op' }))
    const r = await sim.runSim()
    expect(r.variableNames.some((nm) => nm.toLowerCase().includes('drain'))).toBe(true)
  }, 30000)
})

describe('photodiode (BPW 34)', () => {
  // Photodiode = silicon diode (with CJO) + a parallel DC current source. The schematic layer
  // (toCircuit) sets is/n/rs/bv/cj0/iphoto; here we drive buildNetlist directly.
  const pd = (iphoto: number, cathode = '0'): Circuit => ({
    title: 'photodiode',
    components: [
      { kind: 'diode', id: '1', nodes: ['a', cathode], is: 1e-10, n: 1, rs: 10, bv: 32, cj0: 72e-12, iphoto },
      { kind: 'resistor', id: '1', nodes: ['a', '0'], ohms: 1000 }, // load / transimpedance
      { kind: 'ground', id: '0', node: '0' },
    ],
  })

  it('emits CJO in the .model and a parallel Iph source from cathode→anode', () => {
    const nl = buildNetlist(pd(80e-6), { kind: 'op' })
    expect(nl).toContain('D1 a 0 DM1')
    expect(nl).toMatch(/\.model DM1 D\(IS=1\.0000e-10 N=1 RS=10 BV=32 IBV=0\.1u CJO=7\.2000e-11\)/)
    expect(nl).toContain('Iph1 0 a DC 0.00008') // n+ = cathode, n- = anode → sources current out the anode
  })

  it('omits the Iph source when there is no illumination (iphoto 0 / unset)', () => {
    expect(buildNetlist(pd(0), { kind: 'op' })).not.toContain('Iph1')
  })

  it('sources photocurrent out of the anode: V(a) ≈ Iph·R, anode-positive', async () => {
    // 80 µA through a 1 kΩ load → ≈ 80 mV, well below Voc so the junction barely conducts.
    const sim = new Simulation()
    await sim.start()
    sim.setNetList(buildNetlist(pd(80e-6), { kind: 'op' }))
    const v = nodeVoltage(normalizeResult(await sim.runSim()), 'a')
    expect(v).toBeGreaterThan(0.07) // positive (anode sources current) and ≈ Iph·R
    expect(v).toBeLessThan(0.085)
  }, 30000)
})
