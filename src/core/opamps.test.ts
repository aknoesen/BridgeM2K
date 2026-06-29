import { describe, it, expect, beforeAll } from 'vitest'
import { Simulation } from 'eecircuit-engine'
import { buildNetlist, type Circuit } from './netlist'
import { normalizeResult } from './spice'
import {
  opampList, getOpamp, isKitOpamp, buildOpampSubckt, type OpampKind,
} from './opamps'

describe('catalog', () => {
  it('has the 5 verified kit op-amps with the spec params (F-4: BOB duals removed)', () => {
    expect(opampList().map((p) => p.kind)).toEqual([
      'op27', 'op37', 'op97', 'op482', 'op484',
    ])
    expect(getOpamp('op27').gbwHz).toBe(8e6)
    expect(getOpamp('op37').gbwHz).toBe(63e6)
    expect(getOpamp('op37').note).toMatch(/gain ≥ 5/)
    expect(getOpamp('op484').railToRailOut).toBe(true)
    expect(getOpamp('op484').outputHeadroom).toBeLessThan(0.1)
    expect(getOpamp('op27').railToRailOut).toBe(false)
    expect(getOpamp('op27').outputHeadroom).toBeGreaterThan(1)
    expect(getOpamp('op484').supplyMin).toBe(3)
    // every kit op-amp is now a DIP (no BOB breakout parts remain)
    expect(opampList().every((p) => p.package === '8-DIP' || p.package === '14-DIP')).toBe(true)
  })

  it('isKitOpamp distinguishes kit parts from off-kit', () => {
    expect(isKitOpamp('op484')).toBe(true)
    expect(isKitOpamp('op27')).toBe(true)
    expect(isKitOpamp('adtl082')).toBe(false) // removed in F-4
    expect(isKitOpamp('lmc662')).toBe(false)
    expect(isKitOpamp('not-a-part')).toBe(false)
  })

  it('buildOpampSubckt emits a well-formed .subckt … .ends with a rail-referenced clamp', () => {
    const s = buildOpampSubckt(getOpamp('op27'))
    expect(s.split('\n')[0]).toBe('.subckt op27 inp inn vcc vee out')
    expect(s.trimEnd().endsWith('.ends')).toBe(true)
    expect(s).toContain('V(vcc)')
    expect(s).toContain('V(vee)')
    expect(s).toMatch(/Bg 0 no I =/)
  })
})

// End-to-end (mirror SWEEP-1): drive an inverting gain-−10 stage through the real engine and confirm
// the closed-loop gain is right, and that a non-RR part clips short of the rail while a RR part
// swings to it.
describe('op-amp macromodel (engine)', () => {
  let sim: Simulation
  beforeAll(async () => { sim = new Simulation(); await sim.start() })

  // Inverting amp: Rin=1k (in→inn), Rf=10k (inn→out), inP=gnd → gain −10. ±5 V auto rails.
  async function peakOut(part: OpampKind, amplitude: number): Promise<{ mx: number; mn: number }> {
    const ckt: Circuit = {
      title: 'opamp gain test',
      components: [
        { kind: 'vsource', id: '1', nodes: ['in', '0'], dc: 0, sine: { offset: 0, amplitude, freq: 1000 } },
        { kind: 'resistor', id: 'in', nodes: ['in', 'inn'], ohms: 1000 },
        { kind: 'resistor', id: 'f', nodes: ['inn', 'out'], ohms: 10000 },
        { kind: 'opamp', id: '1', model: 'lmc662', part, nodes: { inP: '0', inN: 'inn', out: 'out' } },
        { kind: 'ground', id: '0', node: '0' },
      ],
    }
    const nl = buildNetlist(ckt, { kind: 'tran', step: 2e-6, stop: 3e-3 })
    expect(nl).toContain(`X1 0 inn xop1_vcc xop1_vee out ${part}`)
    expect(nl).toContain(`.subckt ${part} inp inn vcc vee out`)
    sim.setNetList(nl)
    const r = normalizeResult(await sim.runSim())
    const oi = r.variables.findIndex((v) => v.name.toLowerCase() === 'v(out)')
    const col = r.columns[oi]
    const vals = col.kind === 'real' ? col.values : col.mag
    let mx = -1e9, mn = 1e9
    for (const v of vals) { if (v > mx) mx = v; if (v < mn) mn = v }
    return { mx, mn }
  }

  it('gives the correct closed-loop gain (−10): 0.2 V in → ±2 V out', async () => {
    const { mx, mn } = await peakOut('op484', 0.2)
    expect(mx).toBeGreaterThan(1.9); expect(mx).toBeLessThan(2.1)
    expect(mn).toBeLessThan(-1.9); expect(mn).toBeGreaterThan(-2.1)
  }, 60000)

  it('RR part (OP484) swings to the rail; non-RR part (OP27) clips short', async () => {
    const rr = await peakOut('op484', 1.0)   // ideal ±10 V, rails ±5 V
    const std = await peakOut('op27', 1.0)
    expect(rr.mx).toBeGreaterThan(4.5)        // rail-to-rail reaches ~+5 V
    expect(std.mx).toBeLessThan(4.0)          // ~2 V headroom → clips near +3 V
    expect(std.mx).toBeGreaterThan(2.0)       // but still a real (clipped) swing
    expect(rr.mx).toBeGreaterThan(std.mx + 1) // RR clearly swings higher than the standard part
  }, 60000)
})
