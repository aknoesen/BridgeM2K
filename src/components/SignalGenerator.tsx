import { useEffect, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { SignalParams, WaveType } from '../core/signal'
import { exportPlotlyToPng } from './exportImage'
import './Instrument.css'

interface Props {
  params: SignalParams
  params2: SignalParams
  signal: { t: Float64Array; x: Float64Array } | null
  signal2: { t: Float64Array; x: Float64Array } | null
  running: boolean
  compact?: boolean
  onParamChange: <K extends keyof SignalParams>(key: K, value: SignalParams[K]) => void
  onParam2Change: <K extends keyof SignalParams>(key: K, value: SignalParams[K]) => void
  onWaveTypeChange: (w: WaveType) => void
  onRunToggle: () => void
}

const WAVE_TYPES: { value: WaveType; label: string }[] = [
  { value: 'sine',     label: 'Sine' },
  { value: 'square',   label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Sawtooth' },
]

export default function SignalGenerator({ params, params2, signal, signal2, running, compact, onParamChange, onParam2Change, onWaveTypeChange, onRunToggle }: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const initialised = useRef(false)
  // Which generator the controls below edit. Both are always drawn on the plot.
  const [gen, setGen] = useState<'W1' | 'W2'>('W1')

  // Build the time-domain plot — both W1 and W2 so the student always sees both at once.
  useEffect(() => {
    if (!plotRef.current) return
    const el = plotRef.current

    if (!signal && !signal2) {
      if (initialised.current) Plotly.purge(el)
      initialised.current = false
      return
    }

    // Show 4 periods of the slower generator so both are visible. Ignore a transiently empty/NaN
    // frequency field (the field stays clearable mid-typing; the core clamps frequency anyway).
    const validF = [params.frequency, params2.frequency].filter((f) => Number.isFinite(f) && f > 0)
    const fShow = validF.length ? Math.min(...validF) : 1
    const downsample = (s: { t: Float64Array; x: Float64Array }) => {
      const samplesToShow = Math.min(s.t.length, Math.round(4 * params.samplingRate / fShow))
      const step = Math.max(1, Math.floor(samplesToShow / 2000))
      const n = Math.ceil(samplesToShow / step)
      return {
        x: Array.from({ length: n }, (_, i) => s.t[i * step] * 1000),
        y: Array.from({ length: n }, (_, i) => s.x[i * step]),
      }
    }

    const traces: Partial<Plotly.PlotData>[] = []
    if (signal) {
      const d = downsample(signal)
      traces.push({ x: d.x, y: d.y, type: 'scatter', mode: 'lines', line: { color: 'var(--ch1-color)', width: 2.5 }, name: 'W1' })
    }
    if (signal2) {
      const d = downsample(signal2)
      traces.push({ x: d.x, y: d.y, type: 'scatter', mode: 'lines', line: { color: 'var(--ch2-color)', width: 2.5 }, name: 'W2' })
    }

    const layout = {
      paper_bgcolor: 'var(--bg-display)',
      plot_bgcolor: 'var(--bg-display)',
      font: { color: 'var(--text-primary)', size: 11 },
      margin: { l: 50, r: 16, t: 24, b: 40 },
      xaxis: {
        title: { text: 'Time (ms)', font: { size: 11 } },
        gridcolor: '#2a2a2a', zerolinecolor: '#444', tickfont: { size: 10 }, color: 'var(--text-secondary)',
      },
      yaxis: {
        title: { text: 'Amplitude (V)', font: { size: 11 } },
        gridcolor: '#2a2a2a', zerolinecolor: '#444', tickfont: { size: 10 }, color: 'var(--text-secondary)',
      },
      showlegend: true,
      legend: { orientation: 'h' as const, x: 0, y: 1.12, font: { size: 11 } },
    }

    const config = { displayModeBar: false, responsive: true }

    if (!initialised.current) {
      Plotly.newPlot(el, traces, layout, config)
      initialised.current = true
    } else {
      Plotly.react(el, traces, layout, config)
    }
  }, [signal, signal2, params.frequency, params2.frequency, params.samplingRate])

  // Active generator's params + the matching change handlers.
  const p = gen === 'W1' ? params : params2
  const change = <K extends keyof SignalParams>(key: K, value: SignalParams[K]) => {
    if (gen === 'W1') onParamChange(key, value); else onParam2Change(key, value)
  }
  const changeWave = (w: WaveType) => { if (gen === 'W1') onWaveTypeChange(w); else onParam2Change('waveType', w) }

  const freq = p.frequency
  // The number field can be transiently empty/NaN/0/negative while typing; show a dash in the
  // readouts instead of "NaN Hz". The signal itself stays safe (core clamps to a 1 Hz floor).
  const freqValid = Number.isFinite(freq) && freq > 0
  const freqLabel = !freqValid
    ? '—'
    : freq >= 1000 ? `${(freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 2)} kHz` : `${freq} Hz`

  return (
    <div className="instrument-panel">
      {/* ── Display area ── */}
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Signal Generator</span>
          <div className="display-controls">
            <button className={`run-btn ${running ? 'active' : ''}`} onClick={onRunToggle}>
              {running ? '⏹ Stop' : '▶ Run'}
            </button>
            <button className="run-btn" title="Save this plot as a PNG"
              onClick={() => { if (plotRef.current) exportPlotlyToPng(plotRef.current, 'signal-generator.png').catch(() => {}) }}>
              Export PNG
            </button>
          </div>
        </div>
        <div ref={plotRef} className="plotly-display" />
        {!running && (
          <div className="display-overlay">Stopped — press Run to generate</div>
        )}
      </div>

      {/* ── Settings panel ── */}
      <div className="settings-panel" style={compact ? { width: 160 } : undefined}>
        <div className="section-title">Generator</div>
        <div className="control-row">
          <label>Channel</label>
          <div className="wave-selector">
            <button className={gen === 'W1' ? 'active' : ''} onClick={() => setGen('W1')}>W1</button>
            <button className={gen === 'W2' ? 'active' : ''} onClick={() => setGen('W2')}>W2</button>
          </div>
        </div>

        <div className="section-title">Waveform — editing {gen}</div>

        <div className="control-row">
          <label>Type</label>
          <div className="wave-selector">
            {WAVE_TYPES.map(w => (
              <button
                key={w.value}
                className={p.waveType === w.value ? 'active' : ''}
                onClick={() => changeWave(w.value)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="section-title">Parameters</div>

        <div className="control-row-inline">
          <label>Frequency</label>
          <input
            type="number"
            min={1}
            max={20000}
            step={1}
            value={p.frequency}
            onChange={e => change('frequency', Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span className="value-badge">{freqLabel}</span>
        </div>

        <div className="control-row-inline">
          <label>Amplitude</label>
          <input
            type="number"
            min={0.1}
            max={5}
            step={0.1}
            value={p.amplitude}
            onChange={e => change('amplitude', Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span className="value-badge">{p.amplitude.toFixed(1)} V</span>
        </div>

        <div className="control-row-inline">
          <label>Offset</label>
          <input
            type="number"
            min={-5}
            max={5}
            step={0.1}
            value={p.offset}
            onChange={e => change('offset', Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span className="value-badge">{p.offset >= 0 ? '+' : ''}{p.offset.toFixed(1)} V</span>
        </div>

        {p.waveType === 'square' && (
          <>
            <div className="section-title">Square Wave</div>
            <div className="control-row">
              <div className="control-row-inline" style={{ marginBottom: 2 }}>
                <label>Duty Cycle</label>
                <span className="value-badge">{p.dutyCycle}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={99}
                value={p.dutyCycle}
                onChange={e => change('dutyCycle', Number(e.target.value))}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)' }}>
                <span>1%</span>
                <span>50%</span>
                <span>99%</span>
              </div>
            </div>
          </>
        )}

        <div className="section-title">Info — {gen}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <div>Fs: {(p.samplingRate / 1000).toFixed(0)} kSa/s</div>
          <div>Period: {freqValid ? `${(1000 / freq).toFixed(2)} ms` : '—'}</div>
          <div>Average: {(p.offset + (p.waveType === 'square' ? p.amplitude * (2 * p.dutyCycle / 100 - 1) : 0)).toFixed(3)} V</div>
        </div>
      </div>
    </div>
  )
}
