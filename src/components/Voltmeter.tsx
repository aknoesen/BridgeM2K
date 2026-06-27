// Voltmeter (DMM-1) — M2K-style two-channel DC voltmeter. Runs an .op on the drawn circuit
// and reads each ADC channel: Ch1 = V(1+) - V(1-), Ch2 = V(2+) - V(2-). Single-ended when the
// '-' input is wired to ground (the default). See docs/specs/schematic-ngspice.md (WIRE-2).
import { useEffect, useRef, useState } from 'react'
import { SignalParams } from '../core/signal'
import { createSpiceEngine, SpiceEngine, hasNode, differentialVoltage } from '../core/spice'
import { buildNetlist, applyGeneratorParams, applySupplyRails, type Circuit, type SupplySettings } from '../core/netlist'
import './Instrument.css'

interface Props {
  circuit: Circuit
  // Actual probe node names from toCircuit (ch1/ch2 with optional differential '-' nodes). Reading
  // these instead of hardcoded 'out'/'scope2' lets the voltmeter work when a probe shares a net with
  // the input (e.g. the divider's 2+ on the applied-voltage node, which keeps its 'in' name).
  probes?: { ch1?: string; ch1n?: string; ch2?: string; ch2n?: string }
  w1?: SignalParams
  w2?: SignalParams
  psu?: SupplySettings
  compact?: boolean
}

// M2K voltmeter ranges + practical resolution from EEC1 Lab 1 (±25 V → 20 mV, ±2.5 V → 2 mV).
const RANGES = [
  { label: '±25 V', res: 0.02 },
  { label: '±2.5 V', res: 0.002 },
]
const CH1_COLOR = '#f0a030'
const CH2_COLOR = '#40c0e0'

export default function Voltmeter({ circuit, probes, w1, w2, psu, compact }: Props) {
  const engineRef = useRef<SpiceEngine | null>(null)
  const [range, setRange] = useState(0)
  const [ch1, setCh1] = useState<number | null>(null)
  const [ch2, setCh2] = useState<number | null>(null)
  const [status, setStatus] = useState('idle')
  const [busy, setBusy] = useState(false)
  const runningRef = useRef(false)

  async function measure() {
    const eng = engineRef.current
    if (!eng || runningRef.current) return
    runningRef.current = true
    setBusy(true)
    setStatus('measuring…')
    try {
      let ckt = applyGeneratorParams(circuit, w1, w2)
      if (psu) ckt = applySupplyRails(ckt, psu)
      const nl = buildNetlist(ckt, { kind: 'op' })
      const r = await eng.run(nl)
      const read = (pos?: string, neg?: string) =>
        pos && hasNode(r, pos) ? differentialVoltage(r, pos, neg && hasNode(r, neg) ? neg : '0') : null
      setCh1(read(probes?.ch1 ?? 'out', probes?.ch1n ?? 'out_n'))
      setCh2(read(probes?.ch2 ?? 'scope2', probes?.ch2n ?? 'scope2_n'))
      setStatus('measured (.op)')
    } catch (e) {
      setCh1(null)
      setCh2(null)
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      runningRef.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    engineRef.current = createSpiceEngine()
    return () => { engineRef.current?.dispose(); engineRef.current = null }
  }, [])
  // Re-measure when the drawn circuit or generator settings change.
  useEffect(() => { void measure() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuit, probes, w1, w2, psu])

  const fmt = (v: number | null) => {
    if (v === null) return '—'
    const res = RANGES[range].res
    const rounded = Math.round(v / res) * res
    return rounded.toFixed(res < 0.01 ? 3 : 2) + ' V'
  }

  const reading = (label: string, v: number | null, color: string) => (
    <div style={{ background: 'var(--bg-display)', border: '1px solid var(--border)', borderRadius: 4, padding: '14px 18px', marginBottom: 12 }}>
      <div style={{ fontSize: 12, color, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 30, fontFamily: 'monospace', color: v === null ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{fmt(v)}</div>
    </div>
  )

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Voltmeter — DC</span>
          <div className="display-controls">
            <button className={`run-btn ${busy ? '' : 'active'}`} onClick={() => void measure()} disabled={busy}>
              {busy ? 'Measuring…' : '▶ Measure'}
            </button>
          </div>
        </div>
        <div style={{ padding: 20, overflow: 'auto' }}>
          {reading('Channel 1  (1+ − 1−)', ch1, CH1_COLOR)}
          {reading('Channel 2  (2+ − 2−)', ch2, CH2_COLOR)}
          <div style={{ fontSize: 11, color: 'var(--accent-blue)', fontFamily: 'monospace', marginTop: 4 }}>{status}</div>
        </div>
      </div>

      <div className="settings-panel" style={compact ? { width: 160 } : undefined}>
        <div className="section-title">Range</div>
        <div className="control-row-inline">
          <label>Full scale</label>
          <select value={range} onChange={(e) => setRange(Number(e.target.value))} style={{ width: 90 }}>
            {RANGES.map((r, i) => <option key={i} value={i}>{r.label}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          resolution ≈ {RANGES[range].res * 1000} mV
        </div>
        <div className="section-title">How to use</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          In the Circuit tab, wire <b style={{ color: CH1_COLOR }}>1+</b> to a node and
          <b style={{ color: CH1_COLOR }}> 1−</b> to GND (single-ended) or another node
          (differential). Channel 1 reads V(1+) − V(1−); same for Channel 2. Needs a ground.
        </div>
      </div>
    </div>
  )
}
