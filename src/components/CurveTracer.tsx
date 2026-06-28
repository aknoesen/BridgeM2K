// Curve Tracer instrument (SWEEP-1) — parametric characteristic-curve families, the way you trace
// them on a real M2K bench: W1 sweeps the device's swept terminal (Vds / Vce) while W2 holds the
// stepped control (Vgs, or Vbb→Ib through a base resistor) at a DC level; the device current is
// read across a series sense resistor (I = V_sense / R_sense) and the family is shown in scope-XY
// form. It runs the EXISTING `.tran` path through the SPICE worker — one stepped transient pass per
// curve — so it maps 1:1 onto a procedure a student can run on real silicon. The pure logic
// (identify device, build the per-step netlist, extract the curve) lives in core/curvetracer.ts.
import { useEffect, useMemo, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { createSpiceEngine, type SpiceEngine } from '../core/spice'
import { buildNetlist, type Circuit } from '../core/netlist'
import {
  identifyTracer, buildTracerCircuit, tracerAnalysis, extractCurve, type TracerSetup,
} from '../core/curvetracer'
import { exportPlotlyToPng } from './exportImage'
import './Instrument.css'

// Distinct colours per stepped curve (warm→cool), like the scope/Bode channel palette.
const CURVE_COLORS = ['#f0a030', '#ff6b6b', '#e06fd0', '#9b7fff', '#4a9eff', '#40c0e0', '#44dd88']

interface Props {
  circuit?: Circuit       // the drawn circuit (only passed when valid)
  dutName?: string
  compact?: boolean
}

interface FamilyCurve { step: number; vx: number[]; i: number[] }

export default function CurveTracer({ circuit, dutName, compact }: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<SpiceEngine | null>(null)
  const runningRef = useRef(false)

  const setup = useMemo<TracerSetup | null>(() => (circuit ? identifyTracer(circuit) : null), [circuit])

  // Sweep + step controls (component-local view state). The step list is generated from a
  // start / increment / count so the UI stays a few simple knobs; defaults follow the device class.
  const [vMax, setVMax] = useState(5)
  const [rampMs, setRampMs] = useState(5)
  const [stepStart, setStepStart] = useState(2)
  const [stepIncr, setStepIncr] = useState(0.5)
  const [stepCount, setStepCount] = useState(5)

  // Reset the step knobs to sensible defaults whenever the device class changes (BJT vs MOSFET).
  useEffect(() => {
    if (!setup) return
    const d = setup.defaultSteps
    setStepStart(d[0])
    setStepIncr(d.length > 1 ? +(d[1] - d[0]).toFixed(3) : 0.5)
    setStepCount(d.length)
  }, [setup?.device]) // eslint-disable-line react-hooks/exhaustive-deps

  const steps = useMemo(
    () => Array.from({ length: stepCount }, (_, k) => +(stepStart + k * stepIncr).toFixed(3)),
    [stepStart, stepIncr, stepCount],
  )

  const [family, setFamily] = useState<FamilyCurve[]>([])
  const [status, setStatus] = useState('idle')
  const [busy, setBusy] = useState(false)

  async function runFamily() {
    const eng = engineRef.current
    if (!eng || !setup || !circuit || runningRef.current) return
    runningRef.current = true
    setBusy(true)
    setStatus(`tracing ${steps.length} curves…`)
    const t0 = performance.now()
    try {
      const rampSec = rampMs / 1000
      const out: FamilyCurve[] = []
      for (const s of steps) {
        const ckt = buildTracerCircuit(circuit, { vMin: 0, vMax, rampSec, step: s })
        const res = await eng.run(buildNetlist(ckt, tracerAnalysis(rampSec)))
        const cv = extractCurve(res, setup)
        if (cv) out.push({ step: s, vx: cv.vx, i: cv.i })
      }
      setFamily(out)
      setStatus(`traced ${out.length} curves in ${(performance.now() - t0).toFixed(0)} ms`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      runningRef.current = false
      setBusy(false)
    }
  }

  // Create the engine once; dispose on unmount.
  useEffect(() => {
    engineRef.current = createSpiceEngine()
    return () => { engineRef.current?.dispose(); engineRef.current = null }
  }, [])

  // Clear the plot when the circuit is no longer a traceable transistor stage.
  useEffect(() => { if (!setup) setFamily([]) }, [setup])

  // Auto-trace on mount and whenever the circuit or sweep/step settings change. Debounced so
  // dragging a value coalesces to one run after the last edit (CONVENTIONS §10).
  useEffect(() => {
    if (!setup) return
    const h = setTimeout(() => { void runFamily() }, 300)
    return () => clearTimeout(h)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, circuit, vMax, rampMs, stepStart, stepIncr, stepCount])

  // Draw the family (scope-XY conventions: dark theme, no modebar).
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const data: Plotly.Data[] = family.map((c, k) => ({
      x: c.vx, y: c.i.map((a) => a * 1000), // mA
      type: 'scatter', mode: 'lines', hoverinfo: 'none',
      name: `${setup?.stepLabel ?? 'step'}=${c.step} V`,
      line: { color: CURVE_COLORS[k % CURVE_COLORS.length], width: 2 },
    } as Plotly.Data))
    const layout: Partial<Plotly.Layout> = {
      paper_bgcolor: 'var(--bg-display)', plot_bgcolor: 'var(--bg-display)',
      font: { color: 'var(--text-primary)', size: 11 },
      margin: { l: 58, r: 16, t: 14, b: 42 },
      showlegend: true,
      legend: { x: 0.01, xanchor: 'left', y: 0.99, font: { size: 10 }, bgcolor: 'rgba(0,0,0,0.35)' },
      xaxis: {
        title: { text: `${setup?.sweptLabel ?? 'V'} (V)`, font: { size: 11 } },
        autorange: true, rangemode: 'tozero', gridcolor: '#2a2a2a', zerolinecolor: '#444',
        tickfont: { size: 10 }, color: 'var(--text-secondary)',
      },
      yaxis: {
        title: { text: `${setup?.currentLabel ?? 'I'} (mA)`, font: { size: 11 } },
        autorange: true, rangemode: 'tozero', gridcolor: '#2a2a2a', zerolinecolor: '#444',
        tickfont: { size: 10 }, color: 'var(--text-secondary)',
      },
    }
    const config: Partial<Plotly.Config> = { displayModeBar: false, responsive: true }
    Plotly.react(el, data, layout, config)
  }, [family, setup])

  const title = setup
    ? `Curve Tracer — ${setup.kindLabel} ${setup.currentLabel}-vs-${setup.sweptLabel}`
    : 'Curve Tracer'

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">{title}</span>
          <div className="display-controls">
            <button className={`run-btn ${busy ? '' : 'active'}`} onClick={() => void runFamily()} disabled={busy || !setup}>
              {busy ? 'Tracing…' : '▶ Run family'}
            </button>
            <button className="run-btn" title="Save the curve family as a PNG"
              onClick={() => { if (plotRef.current) exportPlotlyToPng(plotRef.current, 'curve-family.png').catch(() => {}) }}>
              Export PNG
            </button>
          </div>
        </div>
        {setup ? (
          <div ref={plotRef} style={{ flex: 1, minHeight: 0 }} />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
            color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
            Draw a transistor stage to trace: a BJT or MOSFET, a <b>W1</b> output on the swept terminal
            (Vce / Vds), a <b>W2</b> output on the control (base resistor / gate), and a sense resistor
            from the emitter / source to ground.<br />Or load <b>MOSFET curve family</b> / <b>BJT curve
            family</b> from the Circuit editor's Examples.
          </div>
        )}
      </div>

      <div className="settings-panel" style={compact ? { width: 170 } : undefined}>
        <div className="section-title">Sweep ({setup?.sweptLabel ?? 'Vds'})</div>
        <div className="control-row-inline">
          <label>Max (V)</label>
          <input type="number" step={1} min={1} max={10} value={vMax}
            onChange={(e) => setVMax(Math.max(1, Number(e.target.value)))} style={{ width: 80 }} />
        </div>
        <div className="control-row-inline" title="Time W1 takes to sweep — slower settles better, faster re-runs quicker">
          <label>Ramp (ms)</label>
          <select value={rampMs} onChange={(e) => setRampMs(Number(e.target.value))} style={{ width: 80 }}>
            {[2, 5, 10, 20].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="section-title">Step ({setup?.stepLabel ?? 'Vgs'})</div>
        <div className="control-row-inline">
          <label>Start (V)</label>
          <input type="number" step={0.5} value={stepStart}
            onChange={(e) => setStepStart(Number(e.target.value))} style={{ width: 80 }} />
        </div>
        <div className="control-row-inline">
          <label>Step (V)</label>
          <input type="number" step={0.1} min={0.1} value={stepIncr}
            onChange={(e) => setStepIncr(Math.max(0.1, Number(e.target.value)))} style={{ width: 80 }} />
        </div>
        <div className="control-row-inline">
          <label>Curves</label>
          <select value={stepCount} onChange={(e) => setStepCount(Number(e.target.value))} style={{ width: 80 }}>
            {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          {setup ? `${setup.stepLabel} = ${steps.join(', ')} V` : '—'}
        </div>

        <div className="section-title">Method</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {setup
            ? <>W1 sweeps <b>{setup.sweptLabel}</b>; W2 steps <b>{setup.stepLabel}</b>; current via the{' '}
              {setup.rsenseOhms} Ω sense resistor (<b>{setup.currentLabel}</b> = V<sub>sense</sub>/R). One{' '}
              <code>.tran</code> pass per curve — the same procedure on a real M2K (W1 sweep, W2 step, scope XY).</>
            : 'Trace BJT/MOSFET output characteristics the hardware-faithful way.'}
        </div>

        <div className="section-title">Status</div>
        <div style={{ fontSize: 11, color: 'var(--accent-blue)', fontFamily: 'monospace' }}>{status}</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8 }}>
          DUT: {dutName ?? 'draw or load a transistor circuit in the Circuit tab'}
        </div>
      </div>
    </div>
  )
}
