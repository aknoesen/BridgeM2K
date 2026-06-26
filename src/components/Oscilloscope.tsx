import { useEffect, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { SignalParams } from '../core/signal'
import { captureWindow, SCOPE_H_DIVS, SCOPE_V_DIVS } from '../core/scope'
import './Instrument.css'

interface Samples { t: Float64Array; x: Float64Array }

interface Props {
  params: SignalParams
  signal: Samples | null   // CH1 (generator)
  signal2: Samples | null  // CH2 (second generator)
  params2: SignalParams
  running: boolean
  compact?: boolean
  onRunToggle: () => void
  onParams2Change: <K extends keyof SignalParams>(key: K, value: SignalParams[K]) => void
}

// 1-2-5 steps. time/div capped so the 10-div window fits the generator capture (16 ms).
const TIME_PER_DIV: { label: string; value: number }[] = [
  { label: '100 µs', value: 0.0001 },
  { label: '200 µs', value: 0.0002 },
  { label: '500 µs', value: 0.0005 },
  { label: '1 ms', value: 0.001 },
]
const VOLTS_PER_DIV: { label: string; value: number }[] = [
  { label: '50 mV', value: 0.05 },
  { label: '100 mV', value: 0.1 },
  { label: '200 mV', value: 0.2 },
  { label: '500 mV', value: 0.5 },
  { label: '1 V', value: 1 },
]
const CH1_COLOR = '#f0a030'
const CH2_COLOR = '#40c0e0'

export default function Oscilloscope({ params, signal, signal2, params2, running, compact, onRunToggle, onParams2Change }: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const initialised = useRef(false)

  const [timePerDiv, setTimePerDiv] = useState(0.001) // 1 ms/div → period of 1 kHz spans 1 div
  const [ch1VoltsPerDiv, setCh1VoltsPerDiv] = useState(0.5)
  const [ch1Offset, setCh1Offset] = useState(0)
  const [ch2Enabled, setCh2Enabled] = useState(false)
  const [ch2VoltsPerDiv, setCh2VoltsPerDiv] = useState(0.5)
  const [ch2Offset, setCh2Offset] = useState(0)

  useEffect(() => {
    if (!plotRef.current) return
    const el = plotRef.current

    if (!signal) {
      if (initialised.current) Plotly.purge(el)
      initialised.current = false
      return
    }

    const Fs = params.samplingRate
    const windowMs = SCOPE_H_DIVS * timePerDiv * 1000
    const half = SCOPE_V_DIVS / 2

    // Plot in graticule divisions so two channels with different volts/div share one grid.
    const data: Plotly.Data[] = []
    const tr1 = captureWindow(signal, Fs, timePerDiv)
    data.push({
      x: tr1.t.map((s) => s * 1000),
      y: tr1.v.map((v) => (v + ch1Offset) / ch1VoltsPerDiv),
      type: 'scatter', mode: 'lines', line: { color: CH1_COLOR, width: 1.5 },
      name: 'CH1', hoverinfo: 'none' as const,
    })
    if (ch2Enabled && signal2) {
      const tr2 = captureWindow(signal2, Fs, timePerDiv)
      data.push({
        x: tr2.t.map((s) => s * 1000),
        y: tr2.v.map((v) => (v + ch2Offset) / ch2VoltsPerDiv),
        type: 'scatter', mode: 'lines', line: { color: CH2_COLOR, width: 1.5 },
        name: 'CH2', hoverinfo: 'none' as const,
      })
    }

    const layout: Partial<Plotly.Layout> = {
      paper_bgcolor: 'var(--bg-display)',
      plot_bgcolor: 'var(--bg-display)',
      font: { color: 'var(--text-primary)', size: 11 },
      margin: { l: 48, r: 16, t: 24, b: 44 },
      showlegend: false,
      xaxis: {
        title: { text: 'Time (ms)', font: { size: 11 } },
        range: [0, windowMs],
        dtick: timePerDiv * 1000,
        gridcolor: '#2a2a2a', zerolinecolor: '#444',
        tickfont: { size: 10 }, color: 'var(--text-secondary)',
      },
      yaxis: {
        title: { text: 'Divisions', font: { size: 11 } },
        range: [-half, half],
        dtick: 1,
        gridcolor: '#2a2a2a', zerolinecolor: '#666',
        tickfont: { size: 10 }, color: 'var(--text-secondary)',
      },
    }
    const config: Partial<Plotly.Config> = { displayModeBar: false, responsive: true }

    if (!initialised.current) {
      Plotly.newPlot(el, data, layout, config)
      initialised.current = true
    } else {
      Plotly.react(el, data, layout, config)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal, signal2, ch2Enabled, timePerDiv, ch1VoltsPerDiv, ch1Offset, ch2VoltsPerDiv, ch2Offset, params.samplingRate])

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">
            Oscilloscope — <span style={{ color: CH1_COLOR }}>CH1</span>
            {ch2Enabled && <> · <span style={{ color: CH2_COLOR }}>CH2</span></>}
          </span>
          <div className="display-controls">
            <button className={`run-btn ${running ? 'active' : ''}`} onClick={onRunToggle}>
              {running ? '⏹ Stop' : '▶ Run'}
            </button>
          </div>
        </div>
        <div ref={plotRef} className="plotly-display" />
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
              <input type="number" min={10} max={20000} step={10} value={params2.frequency}
                onChange={(e) => onParams2Change('frequency', Number(e.target.value))} style={{ width: 80 }} />
            </div>
            <div className="control-row-inline">
              <label>Amplitude</label>
              <input type="number" min={0.1} max={2.5} step={0.1} value={params2.amplitude}
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

        <div className="section-title">Readout</div>
        <div style={{ fontSize: 11, lineHeight: 1.7, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
          <div>Time/div: <span style={{ color: 'var(--ch1-color)' }}>{timePerDiv * 1000} ms</span></div>
          <div>CH1: <span style={{ color: CH1_COLOR }}>{ch1VoltsPerDiv} V/div</span></div>
          {ch2Enabled && <div>CH2: <span style={{ color: CH2_COLOR }}>{ch2VoltsPerDiv} V/div</span></div>}
        </div>
      </div>
    </div>
  )
}
