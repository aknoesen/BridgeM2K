// Network Analyzer instrument (NET-1) — Scopy-style Bode plot. Sweeps a circuit with an
// ngspice .ac analysis (in the SPICE worker) and shows magnitude (dB) + phase (deg) vs log
// frequency. Until SCH-2/LOOP-1 supply a drawn circuit it sweeps a default RC low-pass.
// See docs/specs/schematic-ngspice.md (NET-1).
import { useEffect, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { createSpiceEngine, SpiceEngine, transferFunction } from '../core/spice'
import { buildNetlist, type Circuit } from '../core/netlist'
import './Instrument.css'

// Default device under test: RC low-pass, fc = 1/(2*pi*1k*159.155n) ≈ 1000 Hz.
const DEFAULT_CIRCUIT: Circuit = {
  title: 'RC low-pass (Network Analyzer default)',
  components: [
    { kind: 'vsource', id: '1', nodes: ['in', '0'], dc: 0, acMag: 1 },
    { kind: 'resistor', id: '1', nodes: ['in', 'out'], ohms: 1000 },
    { kind: 'capacitor', id: '1', nodes: ['out', '0'], farads: 159.155e-9 },
    { kind: 'ground', id: '0', node: '0' },
  ],
}

const F_OPTIONS = [
  { label: '1 Hz', value: 1 },
  { label: '10 Hz', value: 10 },
  { label: '100 Hz', value: 100 },
  { label: '1 kHz', value: 1000 },
  { label: '10 kHz', value: 10000 },
  { label: '100 kHz', value: 100000 },
  { label: '1 MHz', value: 1e6 },
  { label: '10 MHz', value: 1e7 },
]
const MAG_COLOR = '#f0a030'
const PHASE_COLOR = '#4a9eff'

interface Props {
  circuit?: Circuit
  compact?: boolean
}

interface BodeData { freq: number[]; magDb: number[]; phaseDeg: number[] }

export default function NetworkAnalyzer({ circuit = DEFAULT_CIRCUIT, compact }: Props) {
  const magRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<SpiceEngine | null>(null)

  const [fStart, setFStart] = useState(10)
  const [fStop, setFStop] = useState(1e6)
  const [pointsPerDecade, setPointsPerDecade] = useState(20)
  const [magMin, setMagMin] = useState(-90)
  const [magMax, setMagMax] = useState(10)
  const [phaseMin] = useState(-180)
  const [phaseMax] = useState(180)

  const [bode, setBode] = useState<BodeData | null>(null)
  const [cutoff, setCutoff] = useState<number | null>(null)
  const [status, setStatus] = useState('idle')
  const [busy, setBusy] = useState(false)
  const runningRef = useRef(false)

  async function runSweep() {
    const eng = engineRef.current
    if (!eng || runningRef.current) return
    runningRef.current = true
    setBusy(true)
    setStatus('sweeping…')
    const t0 = performance.now()
    try {
      const netlist = buildNetlist(circuit, {
        kind: 'ac', sweep: 'dec', points: pointsPerDecade, fStart, fStop,
      })
      const res = await eng.run(netlist)
      const tf = transferFunction(res, 'out', 'in')
      const freq = Array.from(tf.freq)
      const magDb = Array.from(tf.magDb)
      const phaseDeg = Array.from(tf.phaseDeg)
      // -3 dB cutoff relative to the low-frequency (DC) gain
      const ref = magDb[0]
      let fc: number | null = null
      for (let i = 1; i < magDb.length; i++) {
        if (magDb[i - 1] >= ref - 3 && magDb[i] < ref - 3) { fc = freq[i]; break }
      }
      setBode({ freq, magDb, phaseDeg })
      setCutoff(fc)
      setStatus(`swept ${freq.length} pts in ${(performance.now() - t0).toFixed(0)} ms`)
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

  // Run a sweep on mount and whenever the sweep settings or circuit change.
  useEffect(() => { void runSweep() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fStart, fStop, pointsPerDecade, circuit])

  // Draw both plots.
  useEffect(() => {
    if (!bode || !magRef.current || !phaseRef.current) return
    const logRange: [number, number] = [Math.log10(fStart), Math.log10(fStop)]
    const cutoffShape = cutoff
      ? [{ type: 'line' as const, x0: cutoff, x1: cutoff, yref: 'paper' as const, y0: 0, y1: 1,
           line: { color: '#888', width: 1, dash: 'dot' as const } }]
      : []

    const baseX = {
      type: 'log' as const, range: logRange, gridcolor: '#2a2a2a', zerolinecolor: '#444',
      tickfont: { size: 10 }, color: 'var(--text-secondary)',
    }
    const common: Partial<Plotly.Layout> = {
      paper_bgcolor: 'var(--bg-display)', plot_bgcolor: 'var(--bg-display)',
      font: { color: 'var(--text-primary)', size: 11 }, showlegend: false,
    }
    const config: Partial<Plotly.Config> = { displayModeBar: false, responsive: true }

    Plotly.react(magRef.current,
      [{ x: bode.freq, y: bode.magDb, type: 'scatter', mode: 'lines',
         line: { color: MAG_COLOR, width: 1.5 }, hoverinfo: 'none' as const }],
      { ...common, margin: { l: 56, r: 16, t: 22, b: 8 },
        xaxis: { ...baseX, showticklabels: false },
        yaxis: { title: { text: 'Magnitude (dB)', font: { size: 11 } }, range: [magMin, magMax],
                 gridcolor: '#2a2a2a', zerolinecolor: '#444', tickfont: { size: 10 }, color: 'var(--text-secondary)' },
        shapes: cutoffShape,
        annotations: cutoff ? [{ x: Math.log10(cutoff), y: magMin + (magMax - magMin) * 0.12,
          text: `fc ≈ ${cutoff >= 1000 ? (cutoff / 1000).toFixed(2) + ' kHz' : cutoff.toFixed(0) + ' Hz'}`,
          showarrow: false, font: { size: 10, color: '#fff' }, bgcolor: 'rgba(40,40,40,0.9)',
          bordercolor: '#666', borderwidth: 1 }] : [],
      }, config)

    Plotly.react(phaseRef.current,
      [{ x: bode.freq, y: bode.phaseDeg, type: 'scatter', mode: 'lines',
         line: { color: PHASE_COLOR, width: 1.5 }, hoverinfo: 'none' as const }],
      { ...common, margin: { l: 56, r: 16, t: 8, b: 40 },
        xaxis: { ...baseX, title: { text: 'Frequency (Hz)', font: { size: 11 } } },
        yaxis: { title: { text: 'Phase (deg)', font: { size: 11 } }, range: [phaseMin, phaseMax],
                 dtick: 45, gridcolor: '#2a2a2a', zerolinecolor: '#444', tickfont: { size: 10 }, color: 'var(--text-secondary)' },
        shapes: cutoffShape,
      }, config)
  }, [bode, cutoff, magMin, magMax, phaseMin, phaseMax, fStart, fStop])

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Network Analyzer — Bode</span>
          <div className="display-controls">
            <button className={`run-btn ${busy ? '' : 'active'}`} onClick={() => void runSweep()} disabled={busy}>
              {busy ? 'Sweeping…' : '▶ Run sweep'}
            </button>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div ref={magRef} style={{ flex: 1, minHeight: 0 }} />
          <div ref={phaseRef} style={{ flex: 1, minHeight: 0 }} />
        </div>
        <div className="marker-table">
          <div className="marker-row">
            <span className="marker-id">fc</span>
            <span className="marker-freq">
              {cutoff ? (cutoff >= 1000 ? (cutoff / 1000).toFixed(3) + ' kHz' : cutoff.toFixed(1) + ' Hz') : '—'}
            </span>
            <span className="marker-type">-3 dB</span>
          </div>
        </div>
      </div>

      <div className="settings-panel" style={compact ? { width: 160 } : undefined}>
        <div className="section-title">Sweep</div>
        <div className="control-row-inline">
          <label>Start</label>
          <select value={fStart} onChange={(e) => setFStart(Number(e.target.value))} style={{ width: 90 }}>
            {F_OPTIONS.filter((o) => o.value < fStop).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="control-row-inline">
          <label>Stop</label>
          <select value={fStop} onChange={(e) => setFStop(Number(e.target.value))} style={{ width: 90 }}>
            {F_OPTIONS.filter((o) => o.value > fStart).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="control-row-inline">
          <label>Pts/decade</label>
          <select value={pointsPerDecade} onChange={(e) => setPointsPerDecade(Number(e.target.value))} style={{ width: 90 }}>
            {[10, 20, 50, 100].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="section-title">Magnitude</div>
        <div className="control-row-inline">
          <label>Max (dB)</label>
          <input type="number" step={10} value={magMax} onChange={(e) => setMagMax(Number(e.target.value))} style={{ width: 80 }} />
        </div>
        <div className="control-row-inline">
          <label>Min (dB)</label>
          <input type="number" step={10} value={magMin} onChange={(e) => setMagMin(Number(e.target.value))} style={{ width: 80 }} />
        </div>

        <div className="section-title">Status</div>
        <div style={{ fontSize: 11, color: 'var(--accent-blue)', fontFamily: 'monospace' }}>{status}</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8 }}>
          DUT: default RC low-pass (LOOP-1 will sweep the drawn circuit).
        </div>
      </div>
    </div>
  )
}
