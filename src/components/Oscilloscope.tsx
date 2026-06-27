import { useEffect, useMemo, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { SignalParams, generateSignal } from '../core/signal'
import { captureWindow, measureTrace, SCOPE_H_DIVS, SCOPE_V_DIVS, type ScopeMeasurements } from '../core/scope'
import { findEdgeTrigger, findEdgeTriggers, applyHoldoff, findPulseTrigger, nextTriggerState, type Slope, type TriggerMode, type PulsePolarity, type WidthMode } from '../core/trigger'
import './Instrument.css'

interface Samples { t: Float64Array; x: Float64Array }

interface Props {
  params: SignalParams
  signal: Samples | null   // CH1
  signal2: Samples | null  // CH2
  params2: SignalParams
  running: boolean
  // True when CH1/CH2 are circuit outputs (fixed-length .tran). When false the scope
  // synthesises its own capture buffer sized to the timebase, so long time/div works.
  circuitActive?: boolean
  // True when the simulated circuit output is riding the supply rails (clipping) — shows a hint.
  outputClipping?: boolean
  // One-shot request from App (set when an example loads): scope mode + Volts/div framing. Consumed
  // via onScopeApplied so it doesn't re-fire and the user can adjust freely afterward.
  scopeReq?: { xy: boolean; ch1Vdiv?: number; ch2Vdiv?: number } | null
  onScopeApplied?: () => void
  // Sample rate of the circuit-output buffers (signal/signal2) when circuitActive. App sizes
  // a long .tran to the scope window and resamples at this rate; defaults to params rate.
  circuitFs?: number
  // The scope reports its window length (s) so App can size the circuit .tran to cover it.
  onWindowSecChange?: (sec: number) => void
  compact?: boolean
  onRunToggle: () => void
  onParams2Change: <K extends keyof SignalParams>(key: K, value: SignalParams[K]) => void
}

const TIME_PER_DIV: { label: string; value: number }[] = [
  { label: '100 µs', value: 0.0001 },
  { label: '200 µs', value: 0.0002 },
  { label: '500 µs', value: 0.0005 },
  { label: '1 ms', value: 0.001 },
  { label: '2 ms', value: 0.002 },
  { label: '5 ms', value: 0.005 },
  { label: '10 ms', value: 0.01 },
  { label: '20 ms', value: 0.02 },
  { label: '50 ms', value: 0.05 },
  { label: '100 ms', value: 0.1 },
  { label: '200 ms', value: 0.2 },
  { label: '500 ms', value: 0.5 },
  { label: '1 s', value: 1 },
]
const VOLTS_PER_DIV: { label: string; value: number }[] = [
  { label: '50 mV', value: 0.05 },
  { label: '100 mV', value: 0.1 },
  { label: '200 mV', value: 0.2 },
  { label: '500 mV', value: 0.5 },
  { label: '1 V', value: 1 },
  { label: '2 V', value: 2 },   // ±8 V view — fits a rail-clipped op-amp output
  { label: '5 V', value: 5 },   // ±20 V view — matches the M2K ±25 V input span
]
const CH1_COLOR = '#f0a030'
const CH2_COLOR = '#40c0e0'
const TRIG_COLOR = '#dddd44'
const CURSOR_T_COLOR = '#e060c0' // time cursors (magenta)
const CURSOR_V_COLOR = '#60e0c0' // voltage cursors (teal)

const fmtV = (v: number) => (Math.abs(v) < 1 ? `${(v * 1000).toFixed(0)} mV` : `${v.toFixed(3)} V`)
const fmtF = (f: number | null) => (f == null ? '—' : f >= 1000 ? `${(f / 1000).toFixed(3)} kHz` : `${f.toFixed(1)} Hz`)
const fmtT = (s: number | null) => (s == null ? '—' : s < 1e-3 ? `${(s * 1e6).toFixed(1)} µs` : s < 1 ? `${(s * 1e3).toFixed(3)} ms` : `${s.toFixed(4)} s`)
const fmtD = (d: number | null) => (d == null ? '—' : `${(d * 100).toFixed(1)} %`)

export default function Oscilloscope({ params, signal, signal2, params2, running, circuitActive, outputClipping, circuitFs, onWindowSecChange, compact, onRunToggle, onParams2Change, scopeReq, onScopeApplied }: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const initialised = useRef(false)
  const frameRef = useRef(0) // free-running capture-phase counter

  const [timePerDiv, setTimePerDiv] = useState(0.001)
  const [ch1VoltsPerDiv, setCh1VoltsPerDiv] = useState(0.5)
  const [ch1Offset, setCh1Offset] = useState(0)
  const [ch2Enabled, setCh2Enabled] = useState(false)
  const [ch2VoltsPerDiv, setCh2VoltsPerDiv] = useState(0.5)
  const [ch2Offset, setCh2Offset] = useState(0)

  // Trigger (OSC-3)
  const [trigSource, setTrigSource] = useState<'ch1' | 'ch2'>('ch1')
  const [trigLevel, setTrigLevel] = useState(0)
  const [trigSlope, setTrigSlope] = useState<Slope>('rising')
  const [trigMode, setTrigMode] = useState<TriggerMode>('auto')
  const [singleArmed, setSingleArmed] = useState(true)
  const [trigStatus, setTrigStatus] = useState('Auto')

  // OSC-4: trigger type, pulse/width, holdoff
  const [trigType, setTrigType] = useState<'edge' | 'pulse'>('edge')
  const [pulsePolarity, setPulsePolarity] = useState<PulsePolarity>('pos')
  const [pulseWidthMode, setPulseWidthMode] = useState<WidthMode>('lessThan')
  const [pulseWidthMs, setPulseWidthMs] = useState(0.5)
  const [holdoffMs, setHoldoffMs] = useState(0)
  const [trigCounts, setTrigCounts] = useState<{ total: number; kept: number } | null>(null)

  // Measurements + cursors (OSC-5)
  const [showMeas, setShowMeas] = useState(true)
  const [meas1, setMeas1] = useState<ScopeMeasurements | null>(null)
  const [meas2, setMeas2] = useState<ScopeMeasurements | null>(null)
  const [showCursors, setShowCursors] = useState(false)
  const [cx1, setCx1] = useState(2) // time cursor 1 (display units)
  const [cx2, setCx2] = useState(8) // time cursor 2 (display units)
  const [cy1, setCy1] = useState(1) // voltage cursor 1 (divisions)
  const [cy2, setCy2] = useState(-1) // voltage cursor 2 (divisions)
  const [xyMode, setXyMode] = useState(false) // plot CH1 (X) vs CH2 (Y) — I-V curves & Lissajous

  // Apply an example's requested scope setup once, then tell App to clear it (so it doesn't re-fire
  // and the student can still adjust by hand afterward). XY needs CH2, so enable it too; Volts/div
  // presets frame the curve (e.g. a Zener I-V at 2 V/div on X so its −3.3 V breakdown fits).
  useEffect(() => {
    if (!scopeReq) return
    setXyMode(scopeReq.xy)
    if (scopeReq.xy) setCh2Enabled(true)
    if (scopeReq.ch1Vdiv) setCh1VoltsPerDiv(scopeReq.ch1Vdiv)
    if (scopeReq.ch2Vdiv) setCh2VoltsPerDiv(scopeReq.ch2Vdiv)
    onScopeApplied?.()
  }, [scopeReq, onScopeApplied])

  // Display-unit handling: short windows read in ms, long ones (≥1 s) in seconds.
  const windowSec = SCOPE_H_DIVS * timePerDiv
  const useSec = windowSec >= 1
  const tScale = useSec ? 1 : 1000
  const tUnit = useSec ? 's' : 'ms'
  const windowDisp = windowSec * tScale
  const halfR = SCOPE_V_DIVS / 2
  const dtSec = Math.abs(cx2 - cx1) / tScale
  const dvVolts = Math.abs(cy2 - cy1) * ch1VoltsPerDiv

  // Capture buffer. Through a circuit, use the provided .tran samples. Viewing the generator
  // directly, synthesise enough samples for this timebase so long time/div (down to ~1 Hz)
  // displays properly. Cap total samples so very long windows stay cheap (drop the synthetic
  // rate, not the coverage — the trace is downsampled for display anyway).
  const memoSig = circuitActive ? signal : null
  const memoSig2 = circuitActive ? signal2 : null
  const { ch1src, ch2src, srcFs } = useMemo(() => {
    if (circuitActive) return { ch1src: signal, ch2src: signal2, srcFs: circuitFs ?? params.samplingRate }
    const capSec = windowSec * 2.2
    const fs = Math.min(params.samplingRate, Math.max(2000, Math.floor(200000 / capSec)))
    const a = generateSignal({ ...params, samplingRate: fs, duration: capSec })
    const b = ch2Enabled ? generateSignal({ ...params2, samplingRate: fs, duration: capSec }) : null
    return { ch1src: a, ch2src: b, srcFs: fs }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuitActive, circuitFs, memoSig, memoSig2, params, params2, ch2Enabled, windowSec])

  // Report the window length so App can size a circuit .tran to cover long timebases.
  useEffect(() => { onWindowSecChange?.(windowSec) }, [windowSec, onWindowSecChange])

  useEffect(() => {
    if (!plotRef.current) return
    const el = plotRef.current
    if (!ch1src) {
      if (initialised.current) Plotly.purge(el)
      initialised.current = false
      setMeas1(null); setMeas2(null)
      return
    }

    const Fs = srcFs
    const halfWinSec = (SCOPE_H_DIVS / 2) * timePerDiv
    const halfWinSamples = Math.round(halfWinSec * Fs)
    const half = SCOPE_V_DIVS / 2

    // ── Trigger ────────────────────────────────────────────────────────────────
    const src = trigSource === 'ch2' ? ch2src : ch1src
    let trigIdx: number | null = null
    if (src) {
      if (trigType === 'pulse') {
        trigIdx = findPulseTrigger(src.x, trigLevel, pulsePolarity, pulseWidthMode, (pulseWidthMs / 1000) * Fs, halfWinSamples)
        setTrigCounts(null)
      } else if (holdoffMs > 0) {
        // Holdoff demo: list every edge, suppress those inside the holdoff window, align to the first kept.
        const all = findEdgeTriggers(src.x, trigLevel, trigSlope, 0)
        const kept = applyHoldoff(all, (holdoffMs / 1000) * Fs)
        setTrigCounts({ total: all.length, kept: kept.length })
        trigIdx = kept.find((t) => t >= halfWinSamples) ?? (kept.length ? kept[0] : null)
      } else {
        trigIdx = findEdgeTrigger(src.x, trigLevel, trigSlope, halfWinSamples)
        setTrigCounts(null)
      }
    }
    const decision = nextTriggerState({ armed: singleArmed }, trigIdx !== null, trigMode)
    if (decision.state.armed !== singleArmed) setSingleArmed(decision.state.armed)
    setTrigStatus(decision.status)
    if (decision.show === 'hold') return // keep the previous frame on screen

    let offsetSec = 0
    if (decision.show === 'triggered' && trigIdx !== null) {
      offsetSec = Math.max(0, trigIdx / Fs - halfWinSec) // put the edge at centre (50% pre-trigger)
    } else {
      // free-run: advance the capture window each frame so an untriggered trace visibly scrolls
      if (running) frameRef.current += 1
      const maxOffset = Math.max(0, ch1src.x.length / Fs - windowSec)
      offsetSec = maxOffset > 0 ? (frameRef.current * (windowSec / 25)) % maxOffset : 0
    }

    const data: Plotly.Data[] = []
    const tr1 = captureWindow(ch1src, Fs, timePerDiv, offsetSec)

    // ── XY mode: plot CH1 (X) vs CH2 (Y) instead of both vs time. Great for I-V curves (X = device
    // voltage, Y = current via a sense resistor) and Lissajous figures. Both channels scaled onto
    // the same division grid with a square aspect so shapes aren't distorted.
    if (xyMode && ch2src) {
      const tr2 = captureWindow(ch2src, Fs, timePerDiv, offsetSec)
      const n = Math.min(tr1.v.length, tr2.v.length)
      const xs = new Array(n), ys = new Array(n)
      for (let i = 0; i < n; i++) {
        xs[i] = (tr1.v[i] + ch1Offset) / ch1VoltsPerDiv
        ys[i] = (tr2.v[i] + ch2Offset) / ch2VoltsPerDiv
      }
      const winSamples = Math.round(windowSec * Fs)
      const startIdx = Math.max(0, Math.round(offsetSec * Fs))
      setMeas1(measureTrace(ch1src.x.subarray(startIdx, startIdx + winSamples), 1 / Fs))
      setMeas2(measureTrace(ch2src.x.subarray(startIdx, startIdx + winSamples), 1 / Fs))
      const xyLayout: Partial<Plotly.Layout> = {
        paper_bgcolor: 'var(--bg-display)', plot_bgcolor: 'var(--bg-display)',
        font: { color: 'var(--text-primary)', size: 11 },
        margin: { l: 48, r: 16, t: 24, b: 44 }, showlegend: false,
        xaxis: { title: { text: 'CH1 → X (div)', font: { size: 11 } }, range: [-half, half], dtick: 1,
          gridcolor: '#2a2a2a', zerolinecolor: '#666', tickfont: { size: 10 }, color: 'var(--text-secondary)' },
        yaxis: { title: { text: 'CH2 → Y (div)', font: { size: 11 } }, range: [-half, half], dtick: 1,
          scaleanchor: 'x', scaleratio: 1,
          gridcolor: '#2a2a2a', zerolinecolor: '#666', tickfont: { size: 10 }, color: 'var(--text-secondary)' },
      }
      const xyData: Plotly.Data[] = [{
        x: xs, y: ys, type: 'scatter', mode: 'lines', line: { color: '#9b7fff', width: 2 }, hoverinfo: 'none' as const,
      }]
      const xyConfig: Partial<Plotly.Config> = { displayModeBar: false, responsive: true }
      if (!initialised.current) { Plotly.newPlot(el, xyData, xyLayout, xyConfig); initialised.current = true }
      else Plotly.react(el, xyData, xyLayout, xyConfig)
      return
    }

    data.push({
      x: tr1.t.map((s) => s * tScale),
      y: tr1.v.map((v) => (v + ch1Offset) / ch1VoltsPerDiv),
      type: 'scatter', mode: 'lines', line: { color: CH1_COLOR, width: 2.5 }, name: 'CH1', hoverinfo: 'none' as const,
    })
    if (ch2Enabled && ch2src) {
      const tr2 = captureWindow(ch2src, Fs, timePerDiv, offsetSec)
      data.push({
        x: tr2.t.map((s) => s * tScale),
        y: tr2.v.map((v) => (v + ch2Offset) / ch2VoltsPerDiv),
        type: 'scatter', mode: 'lines', line: { color: CH2_COLOR, width: 2.5 }, name: 'CH2', hoverinfo: 'none' as const,
      })
    }

    // Measurements over the full-resolution captured window (not the downsampled trace).
    const winSamples = Math.round(windowSec * Fs)
    const startIdx = Math.max(0, Math.round(offsetSec * Fs))
    setMeas1(measureTrace(ch1src.x.subarray(startIdx, startIdx + winSamples), 1 / Fs))
    setMeas2(ch2Enabled && ch2src ? measureTrace(ch2src.x.subarray(startIdx, startIdx + winSamples), 1 / Fs) : null)

    // Trigger level marker (on the source channel's scaling) + centre alignment line when triggered.
    const srcVpd = trigSource === 'ch2' ? ch2VoltsPerDiv : ch1VoltsPerDiv
    const srcOff = trigSource === 'ch2' ? ch2Offset : ch1Offset
    const trigDiv = (trigLevel + srcOff) / srcVpd
    const shapes: Partial<Plotly.Shape>[] = [
      { type: 'line', x0: 0, x1: windowDisp, y0: trigDiv, y1: trigDiv, line: { color: TRIG_COLOR, width: 1, dash: 'dot' } },
    ]
    if (decision.show === 'triggered') {
      shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: windowDisp / 2, x1: windowDisp / 2, y0: 0, y1: 1, line: { color: TRIG_COLOR, width: 1, dash: 'dot' } })
    }
    if (showCursors) {
      shapes.push(
        { type: 'line', xref: 'x', yref: 'paper', x0: cx1, x1: cx1, y0: 0, y1: 1, line: { color: CURSOR_T_COLOR, width: 1 } },
        { type: 'line', xref: 'x', yref: 'paper', x0: cx2, x1: cx2, y0: 0, y1: 1, line: { color: CURSOR_T_COLOR, width: 1 } },
        { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: cy1, y1: cy1, line: { color: CURSOR_V_COLOR, width: 1 } },
        { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: cy2, y1: cy2, line: { color: CURSOR_V_COLOR, width: 1 } },
      )
    }

    const layout: Partial<Plotly.Layout> = {
      paper_bgcolor: 'var(--bg-display)', plot_bgcolor: 'var(--bg-display)',
      font: { color: 'var(--text-primary)', size: 11 },
      margin: { l: 48, r: 16, t: 24, b: 44 }, showlegend: false,
      xaxis: { title: { text: `Time (${tUnit})`, font: { size: 11 } }, range: [0, windowDisp], dtick: timePerDiv * tScale,
        gridcolor: '#2a2a2a', zerolinecolor: '#444', tickfont: { size: 10 }, color: 'var(--text-secondary)' },
      // Scopy-faithful: vertical grid in divisions; exact volts come from the measurements row and
      // cursors. Per-channel Volts/div + offset scale each trace onto this shared 8-division grid.
      yaxis: { title: { text: 'Divisions', font: { size: 11 } }, range: [-half, half], dtick: 1,
        gridcolor: '#2a2a2a', zerolinecolor: '#666', tickfont: { size: 10 }, color: 'var(--text-secondary)' },
      shapes,
    }
    const config: Partial<Plotly.Config> = { displayModeBar: false, responsive: true }
    if (!initialised.current) { Plotly.newPlot(el, data, layout, config); initialised.current = true }
    else Plotly.react(el, data, layout, config)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch1src, ch2src, srcFs, ch2Enabled, timePerDiv, ch1VoltsPerDiv, ch1Offset, ch2VoltsPerDiv, ch2Offset,
      trigSource, trigLevel, trigSlope, trigMode, singleArmed, running,
      trigType, pulsePolarity, pulseWidthMode, pulseWidthMs, holdoffMs,
      showCursors, cx1, cx2, cy1, cy2, tScale, tUnit, windowDisp, windowSec, xyMode])

  const statusColor = trigStatus.startsWith('Trig') ? TRIG_COLOR : trigStatus === 'Auto' ? '#88dd88' : 'var(--text-secondary)'

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">
            Oscilloscope — <span style={{ color: CH1_COLOR }}>CH1</span>
            {ch2Enabled && <> · <span style={{ color: CH2_COLOR }}>CH2</span></>}
            <span style={{ color: statusColor, marginLeft: 10, fontSize: 11 }}>● {trigStatus}</span>
            {outputClipping && (
              <span style={{ color: '#ffaa55', marginLeft: 10, fontSize: 11 }}
                title="The output is hitting the ±supply rails. Lower the generator amplitude (or the gain) for an undistorted signal.">
                ⚠ output clipping at the rails
              </span>
            )}
          </span>
          <div className="display-controls">
            <button className={`run-btn ${xyMode ? 'active' : ''}`} title="XY mode: plot CH1 (X) vs CH2 (Y) — I-V curves & Lissajous"
              onClick={() => { const on = !xyMode; setXyMode(on); if (on && !ch2Enabled) setCh2Enabled(true) }}>
              {xyMode ? 'YT' : 'XY'}
            </button>
            <button className={`run-btn ${running ? 'active' : ''}`} onClick={onRunToggle}>
              {running ? '⏹ Stop' : '▶ Run'}
            </button>
          </div>
        </div>
        <div ref={plotRef} className="plotly-display" />
        {showMeas && meas1 && (
          <div className="marker-table">
            <div className="marker-row">
              <span className="marker-id" style={{ color: CH1_COLOR }}>CH1</span>
              <span>Vpp {fmtV(meas1.vpp)}</span>
              <span>Vrms {fmtV(meas1.vrms)}</span>
              <span>mean {fmtV(meas1.mean)}</span>
              <span>f {fmtF(meas1.freq)}</span>
              <span>D {fmtD(meas1.duty)}</span>
            </div>
            {ch2Enabled && meas2 && (
              <div className="marker-row">
                <span className="marker-id" style={{ color: CH2_COLOR }}>CH2</span>
                <span>Vpp {fmtV(meas2.vpp)}</span>
                <span>Vrms {fmtV(meas2.vrms)}</span>
                <span>mean {fmtV(meas2.mean)}</span>
                <span>f {fmtF(meas2.freq)}</span>
                <span>D {fmtD(meas2.duty)}</span>
              </div>
            )}
            {showCursors && (
              <div className="marker-row" style={{ marginTop: 2 }}>
                <span className="marker-id" style={{ color: CURSOR_T_COLOR }}>⇿</span>
                <span style={{ color: CURSOR_T_COLOR }}>Δt {fmtT(dtSec)}</span>
                <span style={{ color: CURSOR_T_COLOR }}>1/Δt {fmtF(cx2 !== cx1 ? 1 / dtSec : null)}</span>
                <span style={{ color: CURSOR_V_COLOR }}>ΔV {fmtV(dvVolts)}</span>
              </div>
            )}
          </div>
        )}
        {!running && <div className="display-overlay">Stopped — press Run to acquire</div>}
      </div>

      <div className="settings-panel" style={compact ? { width: 170 } : undefined}>
        <div className="section-title">Horizontal</div>
        <div className="control-row-inline">
          <label>Time/div</label>
          <select value={timePerDiv} onChange={(e) => setTimePerDiv(Number(e.target.value))} style={{ width: 90 }}>
            {TIME_PER_DIV.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
          Window: {windowDisp.toFixed(windowDisp >= 100 ? 0 : 2)} {tUnit} (10 div)
        </div>

        <div className="section-title" style={{ color: TRIG_COLOR }}>Trigger</div>
        <div className="control-row-inline">
          <label>Type</label>
          <select value={trigType} onChange={(e) => setTrigType(e.target.value as 'edge' | 'pulse')} style={{ width: 90 }}>
            <option value="edge">Edge</option>
            <option value="pulse">Pulse / width</option>
          </select>
        </div>
        <div className="control-row-inline">
          <label>Source</label>
          <select value={trigSource} onChange={(e) => setTrigSource(e.target.value as 'ch1' | 'ch2')} style={{ width: 90 }}>
            <option value="ch1">CH1</option>
            <option value="ch2">CH2</option>
          </select>
        </div>
        <div className="control-row-inline">
          <label>Mode</label>
          <select value={trigMode} onChange={(e) => { setTrigMode(e.target.value as TriggerMode); setSingleArmed(true) }} style={{ width: 90 }}>
            <option value="auto">Auto</option>
            <option value="normal">Normal</option>
            <option value="single">Single</option>
          </select>
        </div>
        {trigType === 'edge' ? (
          <>
            <div className="control-row-inline">
              <label>Slope</label>
              <select value={trigSlope} onChange={(e) => setTrigSlope(e.target.value as Slope)} style={{ width: 90 }}>
                <option value="rising">Rising ↑</option>
                <option value="falling">Falling ↓</option>
              </select>
            </div>
            <div className="control-row-inline">
              <label>Holdoff (ms)</label>
              <input type="number" min={0} step={0.1} value={holdoffMs} onChange={(e) => setHoldoffMs(Math.max(0, Number(e.target.value)))} style={{ width: 80 }} />
            </div>
          </>
        ) : (
          <>
            <div className="control-row-inline">
              <label>Polarity</label>
              <select value={pulsePolarity} onChange={(e) => setPulsePolarity(e.target.value as PulsePolarity)} style={{ width: 90 }}>
                <option value="pos">Positive ⊓</option>
                <option value="neg">Negative ⊔</option>
              </select>
            </div>
            <div className="control-row-inline">
              <label>Width is</label>
              <select value={pulseWidthMode} onChange={(e) => setPulseWidthMode(e.target.value as WidthMode)} style={{ width: 90 }}>
                <option value="lessThan">&lt; than</option>
                <option value="greaterThan">&gt; than</option>
              </select>
            </div>
            <div className="control-row-inline">
              <label>Width (ms)</label>
              <input type="number" min={0} step={0.05} value={pulseWidthMs} onChange={(e) => setPulseWidthMs(Math.max(0, Number(e.target.value)))} style={{ width: 80 }} />
            </div>
          </>
        )}
        <div className="control-row-inline">
          <label>Level (V)</label>
          <input type="number" step={0.1} value={trigLevel} onChange={(e) => setTrigLevel(Number(e.target.value))} style={{ width: 80 }} />
        </div>
        {trigMode === 'single' && (
          <button className="run-btn" style={{ marginTop: 6 }} onClick={() => setSingleArmed(true)}>
            {singleArmed ? 'Armed — waiting…' : 'Re-arm'}
          </button>
        )}
        {trigType === 'edge' && holdoffMs > 0 && trigCounts && (
          <div style={{ fontSize: 10, color: TRIG_COLOR, marginTop: 4 }}>
            edges in buffer: {trigCounts.total} → {trigCounts.kept} after holdoff
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
          {trigType === 'pulse'
            ? 'Fires only on a pulse whose width meets the condition — useful for glitch / runt capture.'
            : 'Auto free-runs (scrolls) without a trigger; Normal holds; Single captures one frame then stops.'}
        </div>

        <div className="section-title">Measure</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, marginBottom: 4 }}>
          <input type="checkbox" checked={showMeas} onChange={(e) => setShowMeas(e.target.checked)} />
          <span>Measurements (Vpp, Vrms, mean, f, duty)</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, marginBottom: 6 }}>
          <input type="checkbox" checked={showCursors} onChange={(e) => setShowCursors(e.target.checked)} />
          <span>Cursors</span>
        </label>
        {showCursors && (
          <>
            <div className="control-row-inline">
              <label style={{ color: CURSOR_T_COLOR }}>t1 ({tUnit})</label>
              <input type="range" min={0} max={windowDisp} step={windowDisp / 200} value={cx1} onChange={(e) => setCx1(Number(e.target.value))} style={{ width: 90 }} />
            </div>
            <div className="control-row-inline">
              <label style={{ color: CURSOR_T_COLOR }}>t2 ({tUnit})</label>
              <input type="range" min={0} max={windowDisp} step={windowDisp / 200} value={cx2} onChange={(e) => setCx2(Number(e.target.value))} style={{ width: 90 }} />
            </div>
            <div className="control-row-inline">
              <label style={{ color: CURSOR_V_COLOR }}>v1 (div)</label>
              <input type="range" min={-halfR} max={halfR} step={0.05} value={cy1} onChange={(e) => setCy1(Number(e.target.value))} style={{ width: 90 }} />
            </div>
            <div className="control-row-inline">
              <label style={{ color: CURSOR_V_COLOR }}>v2 (div)</label>
              <input type="range" min={-halfR} max={halfR} step={0.05} value={cy2} onChange={(e) => setCy2(Number(e.target.value))} style={{ width: 90 }} />
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
              Δt / 1/Δt from the two time cursors; ΔV from the two voltage cursors (scaled by CH1 volts/div). Readout in the on-screen table.
            </div>
          </>
        )}

        <div className="section-title" style={{ color: CH1_COLOR }}>CH1</div>
        <div className="control-row-inline">
          <label>Volts/div</label>
          <select value={ch1VoltsPerDiv} onChange={(e) => setCh1VoltsPerDiv(Number(e.target.value))} style={{ width: 90 }}>
            {VOLTS_PER_DIV.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="control-row-inline">
          <label>Offset (V)</label>
          <input type="number" step={0.1} value={ch1Offset} onChange={(e) => setCh1Offset(Number(e.target.value))} style={{ width: 80 }} />
        </div>

        <div className="section-title" style={{ color: CH2_COLOR }}>CH2</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, marginBottom: 6 }}>
          <input type="checkbox" checked={ch2Enabled} onChange={(e) => setCh2Enabled(e.target.checked)} />
          <span style={{ color: ch2Enabled ? CH2_COLOR : 'var(--text-secondary)' }}>Enable CH2</span>
        </label>
        {ch2Enabled && (
          <>
            <div className="control-row-inline">
              <label>Frequency</label>
              <input type="number" min={1} max={20000} step={1} value={params2.frequency}
                onChange={(e) => onParams2Change('frequency', Number(e.target.value))} style={{ width: 80 }} />
            </div>
            <div className="control-row-inline">
              <label>Amplitude</label>
              <input type="number" min={0.1} max={5} step={0.1} value={params2.amplitude}
                onChange={(e) => onParams2Change('amplitude', Number(e.target.value))} style={{ width: 80 }} />
            </div>
            <div className="control-row-inline">
              <label>Volts/div</label>
              <select value={ch2VoltsPerDiv} onChange={(e) => setCh2VoltsPerDiv(Number(e.target.value))} style={{ width: 90 }}>
                {VOLTS_PER_DIV.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="control-row-inline">
              <label>Offset (V)</label>
              <input type="number" step={0.1} value={ch2Offset} onChange={(e) => setCh2Offset(Number(e.target.value))} style={{ width: 80 }} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
