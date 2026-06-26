// Network Analyzer instrument (NET-1) — Scopy-style Bode plot. Sweeps a circuit with an
// ngspice .ac analysis (in the SPICE worker) and shows magnitude (dB) + phase (deg) vs log
// frequency. Each scope probe (1+ / 2+) gives its own transfer function vs the W1 input, and
// the user picks CH1, CH2, or Both — mirroring the two scope channels. Until SCH-2/LOOP-1
// supply a drawn circuit it sweeps a default RC low-pass. See docs/specs/schematic-ngspice.md.
import { useEffect, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { createSpiceEngine, SpiceEngine, transferFunction, type SimResult } from '../core/spice'
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
const CH1_COLOR = '#f0a030' // matches scope CH1 (--ch1-color)
const CH2_COLOR = '#40c0e0' // matches scope CH2 (--ch2-color)

interface Props {
  circuit?: Circuit
  dutName?: string
  // SPICE node each scope probe is wired to (from toCircuit). ch1 defaults to 'out'.
  probes?: { ch1?: string; ch2?: string }
  compact?: boolean
}

interface BodeData { freq: number[]; magDb: number[]; phaseDeg: number[] }
type ChannelSel = 'ch1' | 'ch2' | 'both'

// Transfer function V(node)/V(in) as plottable arrays, or null if the node isn't in the result.
function bodeFor(res: SimResult, node: string): BodeData | null {
  try {
    const tf = transferFunction(res, node, 'in')
    return { freq: Array.from(tf.freq), magDb: Array.from(tf.magDb), phaseDeg: Array.from(tf.phaseDeg) }
  } catch {
    return null
  }
}

// -3 dB cutoff relative to the low-frequency gain.
function findCutoff(b: BodeData): number | null {
  const ref = b.magDb[0]
  for (let i = 1; i < b.magDb.length; i++) {
    if (b.magDb[i - 1] >= ref - 3 && b.magDb[i] < ref - 3) return b.freq[i]
  }
  return null
}

export default function NetworkAnalyzer({ circuit = DEFAULT_CIRCUIT, dutName, probes, compact }: Props) {
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

  const [bode1, setBode1] = useState<BodeData | null>(null)
  const [bode2, setBode2] = useState<BodeData | null>(null)
  const [channel, setChannel] = useState<ChannelSel>('ch1')
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
      const b1 = bodeFor(res, probes?.ch1 ?? 'out')
      const b2 = probes?.ch2 ? bodeFor(res, probes.ch2) : null
      setBode1(b1)
      setBode2(b2)
      const pts = b1?.freq.length ?? b2?.freq.length ?? 0
      setStatus(`swept ${pts} pts in ${(performance.now() - t0).toFixed(0)} ms`)
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
  }, [fStart, fStop, pointsPerDecade, circuit, probes])

  // If CH2 isn't available (no 2+ probe), fall back to CH1.
  useEffect(() => { if (!bode2 && channel !== 'ch1') setChannel('ch1') }, [bode2, channel])

  // Draw both plots.
  useEffect(() => {
    if (!magRef.current || !phaseRef.current) return
    const showCh1 = (channel === 'ch1' || channel === 'both') && !!bode1
    const showCh2 = (channel === 'ch2' || channel === 'both') && !!bode2
    const primary = channel === 'ch2' ? bode2 : (bode1 ?? bode2)
    const cutoff = primary ? findCutoff(primary) : null

    const logRange: [number, number] = [Math.log10(fStart), Math.log10(fStop)]
    const cutoffShape = cutoff
      ? [{ type: 'line' as const, x0: cutoff, x1: cutoff, yref: 'paper' as const, y0: 0, y1: 1,
           line: { color: '#888', width: 1, dash: 'dot' as const } }]
      : []

    const baseX = {
      type: 'log' as const, range: logRange, gridcolor: '#2a2a2a', zerolinecolor: '#444',
      tickfont: { size: 10 }, color: 'var(--text-secondary)',
    }
    const showLegend = channel === 'both' && showCh1 && showCh2
    const common: Partial<Plotly.Layout> = {
      paper_bgcolor: 'var(--bg-display)', plot_bgcolor: 'var(--bg-display)',
      font: { color: 'var(--text-primary)', size: 11 }, showlegend: showLegend,
      legend: { x: 1, xanchor: 'right', y: 1, font: { size: 10 }, bgcolor: 'rgba(0,0,0,0)' },
    }
    const config: Partial<Plotly.Config> = { displayModeBar: false, responsive: true }

    const magData: Plotly.Data[] = []
    const phaseData: Plotly.Data[] = []
    if (showCh1 && bode1) {
      magData.push({ x: bode1.freq, y: bode1.magDb, type: 'scatter', mode: 'lines', name: 'CH1',
        line: { color: CH1_COLOR, width: 2.5 }, hoverinfo: 'none' } as Plotly.Data)
      phaseData.push({ x: bode1.freq, y: bode1.phaseDeg, type: 'scatter', mode: 'lines', name: 'CH1',
        line: { color: CH1_COLOR, width: 2.5 }, hoverinfo: 'none' } as Plotly.Data)
    }
    if (showCh2 && bode2) {
      magData.push({ x: bode2.freq, y: bode2.magDb, type: 'scatter', mode: 'lines', name: 'CH2',
        line: { color: CH2_COLOR, width: 2.5 }, hoverinfo: 'none' } as Plotly.Data)
      phaseData.push({ x: bode2.freq, y: bode2.phaseDeg, type: 'scatter', mode: 'lines', name: 'CH2',
        line: { color: CH2_COLOR, width: 2.5 }, hoverinfo: 'none' } as Plotly.Data)
    }

    const cutoffAnno = cutoff ? [{ x: Math.log10(cutoff), y: magMin + (magMax - magMin) * 0.12,
      text: `fc ≈ ${cutoff >= 1000 ? (cutoff / 1000).toFixed(2) + ' kHz' : cutoff.toFixed(0) + ' Hz'}`,
      showarrow: false, font: { size: 10, color: '#fff' }, bgcolor: 'rgba(40,40,40,0.9)',
      bordercolor: '#666', borderwidth: 1 }] : []

    Plotly.react(magRef.current, magData,
      { ...common, margin: { l: 56, r: 16, t: 22, b: 8 },
        xaxis: { ...baseX, showticklabels: false },
        yaxis: { title: { text: 'Magnitude (dB)', font: { size: 11 } }, range: [magMin, magMax],
                 gridcolor: '#2a2a2a', zerolinecolor: '#444', tickfont: { size: 10 }, color: 'var(--text-secondary)' },
        shapes: cutoffShape, annotations: cutoffAnno,
      }, config)

    Plotly.react(phaseRef.current, phaseData,
      { ...common, margin: { l: 56, r: 16, t: 8, b: 40 }, showlegend: false,
        xaxis: { ...baseX, title: { text: 'Frequency (Hz)', font: { size: 11 } } },
        yaxis: { title: { text: 'Phase (deg)', font: { size: 11 } }, range: [phaseMin, phaseMax],
                 dtick: 45, gridcolor: '#2a2a2a', zerolinecolor: '#444', tickfont: { size: 10 }, color: 'var(--text-secondary)' },
        shapes: cutoffShape,
      }, config)
  }, [bode1, bode2, channel, magMin, magMax, phaseMin, phaseMax, fStart, fStop])

  const primaryBode = channel === 'ch2' ? bode2 : (bode1 ?? bode2)
  const fc = primaryBode ? findCutoff(primaryBode) : null

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
              {fc ? (fc >= 1000 ? (fc / 1000).toFixed(3) + ' kHz' : fc.toFixed(1) + ' Hz') : '—'}
            </span>
            <span className="marker-type">-3 dB ({channel === 'ch2' ? 'CH2' : 'CH1'})</span>
          </div>
        </div>
      </div>

      <div className="settings-panel" style={compact ? { width: 160 } : undefined}>
        <div className="section-title">Channels</div>
        <div className="wave-selector">
          <button className={channel === 'ch1' ? 'active' : ''} onClick={() => setChannel('ch1')}>CH1</button>
          <button className={channel === 'ch2' ? 'active' : ''} onClick={() => setChannel('ch2')} disabled={!bode2}>CH2</button>
          <button className={channel === 'both' ? 'active' : ''} onClick={() => setChannel('both')} disabled={!bode2}>Both</button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          {bode2 ? 'CH1 = 1+ node, CH2 = 2+ node (both vs W1 input).' : 'Wire a 2+ probe to compare a second node.'}
        </div>

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
          DUT: {dutName ?? 'default RC low-pass (draw a circuit in the Circuit tab to sweep it)'}
        </div>
      </div>
    </div>
  )
}
