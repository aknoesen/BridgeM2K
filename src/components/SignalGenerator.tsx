import { useEffect, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'
import { SignalParams, WaveType } from '../core/signal'
import './Instrument.css'

interface Props {
  params: SignalParams
  signal: { t: Float64Array; x: Float64Array } | null
  running: boolean
  compact?: boolean
  onParamChange: <K extends keyof SignalParams>(key: K, value: SignalParams[K]) => void
  onWaveTypeChange: (w: WaveType) => void
  onRunToggle: () => void
}

const WAVE_TYPES: { value: WaveType; label: string }[] = [
  { value: 'sine',     label: 'Sine' },
  { value: 'square',   label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Sawtooth' },
]

export default function SignalGenerator({ params, signal, running, compact, onParamChange, onWaveTypeChange, onRunToggle }: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const initialised = useRef(false)

  // Build the time-domain plot
  useEffect(() => {
    if (!plotRef.current) return
    const el = plotRef.current

    if (!signal) {
      if (initialised.current) Plotly.purge(el)
      initialised.current = false
      return
    }

    // Show 4 complete periods regardless of total signal length
    const periodsToShow = 4
    const samplesToShow = Math.min(
      signal.t.length,
      Math.round(periodsToShow * params.samplingRate / params.frequency)
    )
    const step = Math.max(1, Math.floor(samplesToShow / 2000))
    const tDisp = Array.from({ length: Math.ceil(samplesToShow / step) }, (_, i) => signal.t[i * step])
    const xDisp = Array.from({ length: Math.ceil(samplesToShow / step) }, (_, i) => signal.x[i * step])

    const trace = {
      x: tDisp.map(v => v * 1000),  // convert to ms
      y: xDisp,
      type: 'scatter' as const,
      mode: 'lines' as const,
      line: { color: 'var(--ch1-color)', width: 2.5 },
      name: 'W1',
    }

    const layout = {
      paper_bgcolor: 'var(--bg-display)',
      plot_bgcolor: 'var(--bg-display)',
      font: { color: 'var(--text-primary)', size: 11 },
      margin: { l: 50, r: 16, t: 24, b: 40 },
      xaxis: {
        title: { text: 'Time (ms)', font: { size: 11 } },
        gridcolor: '#2a2a2a',
        zerolinecolor: '#444',
        tickfont: { size: 10 },
        color: 'var(--text-secondary)',
      },
      yaxis: {
        title: { text: 'Amplitude (V)', font: { size: 11 } },
        gridcolor: '#2a2a2a',
        zerolinecolor: '#444',
        tickfont: { size: 10 },
        color: 'var(--text-secondary)',
      },
      showlegend: false,
    }

    const config = { displayModeBar: false, responsive: true }

    if (!initialised.current) {
      Plotly.newPlot(el, [trace], layout, config)
      initialised.current = true
    } else {
      Plotly.react(el, [trace], layout, config)
    }
  }, [signal])

  const freq = params.frequency
  const freqLabel = freq >= 1000 ? `${(freq / 1000).toFixed(freq % 1000 === 0 ? 0 : 2)} kHz` : `${freq} Hz`

  return (
    <div className="instrument-panel">
      {/* ── Display area ── */}
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Signal Generator — W1</span>
          <div className="display-controls">
            <button className={`run-btn ${running ? 'active' : ''}`} onClick={onRunToggle}>
              {running ? '⏹ Stop' : '▶ Run'}
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
        <div className="section-title">Waveform</div>

        <div className="control-row">
          <label>Type</label>
          <div className="wave-selector">
            {WAVE_TYPES.map(w => (
              <button
                key={w.value}
                className={params.waveType === w.value ? 'active' : ''}
                onClick={() => onWaveTypeChange(w.value)}
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
            min={10}
            max={20000}
            step={10}
            value={params.frequency}
            onChange={e => onParamChange('frequency', Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span className="value-badge">{freqLabel}</span>
        </div>

        <div className="control-row-inline">
          <label>Amplitude</label>
          <input
            type="number"
            min={0.1}
            max={2.5}
            step={0.1}
            value={params.amplitude}
            onChange={e => onParamChange('amplitude', Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span className="value-badge">{params.amplitude.toFixed(1)} V</span>
        </div>

        <div className="control-row-inline">
          <label>Offset</label>
          <input
            type="number"
            min={-2.5}
            max={2.5}
            step={0.1}
            value={params.offset}
            onChange={e => onParamChange('offset', Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span className="value-badge">{params.offset >= 0 ? '+' : ''}{params.offset.toFixed(1)} V</span>
        </div>

        {params.waveType === 'square' && (
          <>
            <div className="section-title">Square Wave</div>
            <div className="control-row">
              <div className="control-row-inline" style={{ marginBottom: 2 }}>
                <label>Duty Cycle</label>
                <span className="value-badge">{params.dutyCycle}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={99}
                value={params.dutyCycle}
                onChange={e => onParamChange('dutyCycle', Number(e.target.value))}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)' }}>
                <span>1%</span>
                <span>50%</span>
                <span>99%</span>
              </div>
            </div>
          </>
        )}

        <div className="section-title">Info</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
          <div>Fs: {(params.samplingRate / 1000).toFixed(0)} kSa/s</div>
          <div>Period: {(1000 / params.frequency).toFixed(2)} ms</div>
          {signal && <div>FFT: {signal.t.length} pts → {(params.samplingRate / signal.t.length).toFixed(1)} Hz/bin</div>}
          <div>Average: {(params.offset + (params.waveType === 'square' ? params.amplitude * (2 * params.dutyCycle / 100 - 1) : 0)).toFixed(3)} V</div>
        </div>
      </div>
    </div>
  )
}
