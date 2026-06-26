import { useEffect, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { SignalParams, computeSpectrum, theoreticalHarmonics, WindowType } from '../core/signal'
import './Instrument.css'

type Samples = { t: Float64Array; x: Float64Array }

interface Props {
  params: SignalParams
  signal: Samples | null
  params2: SignalParams
  signal2: Samples | null
  running: boolean
  compact?: boolean
  onParamChange: <K extends keyof SignalParams>(key: K, value: SignalParams[K]) => void
  onParam2Change: <K extends keyof SignalParams>(key: K, value: SignalParams[K]) => void
  onRunToggle: () => void
}

const WINDOWS: { label: string; value: WindowType }[] = [
  { label: 'Hanning',   value: 'hanning'   },
  { label: 'Hamming',   value: 'hamming'   },
  { label: 'Blackman',  value: 'blackman'  },
  { label: 'Flat Top',  value: 'flat-top'  },
  { label: 'Rectangle', value: 'rectangle' },
]
const BIT_DEPTHS = [4, 8, 12]
const PERSIST_DEPTH = 20   // frames kept for fade persistence
const CH1_HEX = '#f0a030'
const CH2_HEX = '#40c0e0'
const CH1_RGB = '240,160,48'
const CH2_RGB = '64,192,224'

type ChannelSel = 'ch1' | 'ch2' | 'both'

interface SpecSlice { freq: number[]; amp: number[]; noiseFloorDbfs: number; binWidthHz: number }

// Compute the displayed spectrum slice (DC bin dropped, limited to freqMax).
function specSlice(sig: Samples, Fs: number, bits: number, windowType: WindowType, freqMax: number): SpecSlice {
  const { freqAxis, magnitudeDbfs, noiseFloorDbfs, binWidthHz } = computeSpectrum(sig.x, Fs, bits, 5, windowType)
  const maxIdx = freqAxis.findIndex(f => f > freqMax) || freqAxis.length
  return {
    freq: Array.from(freqAxis.slice(1, maxIdx)),
    amp: Array.from(magnitudeDbfs.slice(1, maxIdx)),
    noiseFloorDbfs, binWidthHz,
  }
}

// Parabolic-interpolated peak (freq, amp).
function peakOf(s: SpecSlice): [number, number] {
  let peakIdx = 0, peak = -200
  for (let i = 0; i < s.amp.length; i++) if (s.amp[i] > peak) { peak = s.amp[i]; peakIdx = i }
  let f = s.freq[peakIdx]
  if (peakIdx > 0 && peakIdx < s.amp.length - 1) {
    const l = s.amp[peakIdx - 1], m = s.amp[peakIdx], r = s.amp[peakIdx + 1]
    f = s.freq[peakIdx] + (0.5 * (r - l) / (2 * m - l - r)) * s.binWidthHz
  }
  return [f, peak]
}

function makeLayout(freqMax: number, peakFreq: number | null, peakAmp: number | null): Partial<Plotly.Layout> {
  return {
    paper_bgcolor: 'var(--bg-display)', plot_bgcolor: 'var(--bg-display)',
    font: { color: 'var(--text-primary)', size: 11 },
    margin: { l: 56, r: 16, t: 24, b: 44 },
    xaxis: { title: { text: 'Frequency (Hz)', font: { size: 11 } }, range: [0, freqMax],
      gridcolor: '#2a2a2a', zerolinecolor: '#444', tickfont: { size: 10 }, color: 'var(--text-secondary)' },
    yaxis: { title: { text: 'Amplitude (dBFS)', font: { size: 11 } }, range: [-120, 5],
      gridcolor: '#2a2a2a', zerolinecolor: '#444', tickfont: { size: 10 }, color: 'var(--text-secondary)' },
    legend: { font: { size: 10 }, bgcolor: 'rgba(30,30,30,0.8)', bordercolor: 'var(--border)', borderwidth: 1 },
    annotations: (peakFreq !== null && peakAmp !== null) ? [{
      x: peakFreq, y: peakAmp,
      text: `M1: ${(peakFreq / 1000).toFixed(2)} kHz<br>${peakAmp.toFixed(1)} dBFS`,
      showarrow: true, arrowhead: 2, arrowcolor: '#ffffff88',
      font: { size: 10, color: '#ffffff' }, bgcolor: 'rgba(40,40,40,0.9)', bordercolor: '#666', borderwidth: 1,
    }] : [],
  }
}

export default function SpectrumAnalyzer({
  params, signal, params2, signal2, running, compact, onParamChange, onParam2Change, onRunToggle,
}: Props) {
  const plotRef = useRef<HTMLDivElement>(null)
  const initialised = useRef(false)

  // Persistence buffers — cleared whenever the display geometry / channel changes
  const fadeBufferRef = useRef<number[][]>([])
  const avgBufferRef  = useRef<number[] | null>(null)
  const avgCountRef   = useRef(0)
  const prevBinCountRef = useRef(0)

  const [channel, setChannel] = useState<ChannelSel>('ch1')
  const [bits, setBits]           = useState(12)
  const [showTheory, setShowTheory] = useState(false)
  const [freqMax, setFreqMax]     = useState(10000)
  const [windowType, setWindowType] = useState<WindowType>('hanning')
  const [persistence, setPersistence] = useState(false)
  const [showAvg, setShowAvg]     = useState(true)
  const [markerFreq, setMarkerFreq] = useState<number | null>(null)
  const [markerAmp, setMarkerAmp]   = useState<number | null>(null)

  // Which params the Signal controls edit (CH2 when CH2 is the sole selection, else CH1).
  const editIsCh2 = channel === 'ch2'
  const par = editIsCh2 ? params2 : params
  const onParChange = editIsCh2 ? onParam2Change : onParamChange
  const chLabel = channel === 'both' ? 'CH1 + CH2' : channel === 'ch2' ? 'CH2' : 'CH1'

  // Reset persistence buffers when display settings or channel change
  useEffect(() => {
    fadeBufferRef.current = []
    avgBufferRef.current  = null
    avgCountRef.current   = 0
    prevBinCountRef.current = 0
  }, [bits, freqMax, windowType, channel,
      params.frequency, params.waveType, params.dutyCycle, params.samplingRate,
      params2.frequency, params2.waveType, params2.dutyCycle])

  useEffect(() => {
    if (!plotRef.current) return
    const el = plotRef.current

    // ── Both channels: simple dual live overlay against the shared noise floor ──
    if (channel === 'both' && signal && signal2) {
      const s1 = specSlice(signal, params.samplingRate, bits, windowType, freqMax)
      const s2 = specSlice(signal2, params2.samplingRate, bits, windowType, freqMax)
      const [pf, pa] = peakOf(s1)
      setMarkerFreq(pf); setMarkerAmp(pa)
      const traces: Plotly.Data[] = [
        { x: s1.freq, y: s1.amp, type: 'scatter', mode: 'lines', line: { color: CH1_HEX, width: 2 }, name: 'CH1' },
        { x: s2.freq, y: s2.amp, type: 'scatter', mode: 'lines', line: { color: CH2_HEX, width: 2 }, name: 'CH2' },
        { x: [s1.freq[0], s1.freq[s1.freq.length - 1]], y: [s1.noiseFloorDbfs, s1.noiseFloorDbfs],
          type: 'scatter', mode: 'lines', line: { color: '#ff4444', width: 1, dash: 'dot' }, name: `Floor (${bits}-bit)` },
      ]
      const layout = makeLayout(freqMax, pf, pa)
      const config: Partial<Plotly.Config> = { displayModeBar: false, responsive: true, scrollZoom: true }
      if (!initialised.current) { Plotly.newPlot(el, traces, layout, config); initialised.current = true }
      else Plotly.react(el, traces, layout, config)
      return
    }

    // ── Single channel: full Learning-Mode pipeline on the selected channel ──
    const sig = channel === 'ch2' ? signal2 : signal
    const sigPar = channel === 'ch2' ? params2 : params
    const liveHex = channel === 'ch2' ? CH2_HEX : CH1_HEX
    const liveRgb = channel === 'ch2' ? CH2_RGB : CH1_RGB

    if (!sig) {
      if (initialised.current) Plotly.purge(el)
      initialised.current = false
      setMarkerFreq(null); setMarkerAmp(null)
      return
    }

    const s = specSlice(sig, sigPar.samplingRate, bits, windowType, freqMax)
    const freqDisp = s.freq, ampDisp = s.amp

    if (ampDisp.length !== prevBinCountRef.current) {
      fadeBufferRef.current = []
      avgBufferRef.current  = null
      avgCountRef.current   = 0
      prevBinCountRef.current = ampDisp.length
    }

    if (persistence) {
      fadeBufferRef.current = [ampDisp, ...fadeBufferRef.current].slice(0, PERSIST_DEPTH)
    } else {
      fadeBufferRef.current = []
    }

    if (showAvg) {
      if (!avgBufferRef.current) {
        avgBufferRef.current = [...ampDisp]
        avgCountRef.current  = 1
      } else {
        avgCountRef.current = Math.min(avgCountRef.current + 1, 60)
        const alpha = 1 / avgCountRef.current
        for (let i = 0; i < ampDisp.length; i++) {
          avgBufferRef.current[i] = (1 - alpha) * avgBufferRef.current[i] + alpha * ampDisp[i]
        }
      }
    } else {
      avgBufferRef.current = null
      avgCountRef.current  = 0
    }

    const [localPeakFreq, localPeakAmp] = peakOf(s)
    setMarkerFreq(localPeakFreq)
    setMarkerAmp(localPeakAmp)

    const traces: Plotly.Data[] = []

    if (persistence && fadeBufferRef.current.length > 1) {
      for (let i = fadeBufferRef.current.length - 1; i >= 1; i--) {
        const opacity = Math.pow(0.78, i) * 0.7
        traces.push({
          x: freqDisp, y: fadeBufferRef.current[i], type: 'scatter', mode: 'lines',
          line: { color: `rgba(${liveRgb},${opacity.toFixed(3)})`, width: 1 },
          showlegend: false, hoverinfo: 'none' as const,
        })
      }
    }

    traces.push({
      x: freqDisp, y: ampDisp, type: 'scatter', mode: 'lines',
      line: { color: showAvg ? `rgba(${liveRgb},0.25)` : liveHex, width: 2 },
      name: `${chLabel} (live)`,
    })

    if (showAvg && avgBufferRef.current) {
      traces.push({
        x: freqDisp, y: avgBufferRef.current, type: 'scatter', mode: 'lines',
        line: { color: '#44aaff', width: 2.5 }, name: `Avg (n=${avgCountRef.current})`,
      })
    }

    traces.push({
      x: [freqDisp[0], freqDisp[freqDisp.length - 1]], y: [s.noiseFloorDbfs, s.noiseFloorDbfs],
      type: 'scatter', mode: 'lines', line: { color: '#ff4444', width: 1, dash: 'dot' }, name: `Floor (${bits}-bit)`,
    })

    if (showTheory) {
      const theory = theoreticalHarmonics(sigPar.waveType, sigPar.amplitude, sigPar.frequency, sigPar.dutyCycle, 15)
      const theoryFreqs: number[] = [], theoryDbfs: number[] = []
      theory.frequencies.forEach((f, i) => {
        if (f <= freqMax) {
          theoryFreqs.push(f)
          theoryDbfs.push(20 * Math.log10((theory.amplitudesV[i] + 1e-12) / 2.5))
        }
      })
      traces.push({
        x: theoryFreqs, y: theoryDbfs, type: 'scatter', mode: 'markers',
        marker: { color: '#44dd88', size: 8, symbol: 'diamond' }, name: 'Theory',
      })
    }

    const layout = makeLayout(freqMax, localPeakFreq, localPeakAmp)
    const config: Partial<Plotly.Config> = { displayModeBar: false, responsive: true, scrollZoom: true }
    if (!initialised.current) { Plotly.newPlot(el, traces, layout, config); initialised.current = true }
    else Plotly.react(el, traces, layout, config)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal, signal2, channel, bits, showTheory, freqMax, params, params2, windowType, persistence, showAvg])

  const snrDb = (6.02 * bits + 1.76).toFixed(0)

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Spectrum Analyzer — {chLabel}</span>
          <div className="display-controls">
            <button className={`run-btn ${running ? 'active' : ''}`} onClick={onRunToggle}>
              {running ? '⏹ Stop' : '▶ Run'}
            </button>
          </div>
        </div>
        <div ref={plotRef} className="plotly-display" />
        {!running && <div className="display-overlay">Stopped — press Run to acquire</div>}
        {markerFreq !== null && markerAmp !== null && running && (
          <div className="marker-table">
            <div className="marker-row">
              <span className="marker-id">M1</span>
              <span className="marker-freq">{(markerFreq / 1000).toFixed(3)} kHz</span>
              <span className="marker-amp">{markerAmp.toFixed(2)} dBFS</span>
              <span className="marker-type">Peak</span>
            </div>
          </div>
        )}
      </div>

      <div className="settings-panel" style={compact ? { width: 160 } : undefined}>
        <div className="section-title">Channels</div>
        <div className="wave-selector">
          <button className={channel === 'ch1' ? 'active' : ''} onClick={() => setChannel('ch1')}>CH1</button>
          <button className={channel === 'ch2' ? 'active' : ''} onClick={() => setChannel('ch2')} disabled={!signal2}>CH2</button>
          <button className={channel === 'both' ? 'active' : ''} onClick={() => setChannel('both')} disabled={!signal2}>Both</button>
        </div>
        {channel === 'both' && (
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
            Both: live overlay only. Learning Mode (theory, persistence, average) applies to a single channel.
          </div>
        )}

        <div className="section-title">Sweep</div>
        <div className="control-row-inline">
          <label>Stop freq</label>
          <select value={freqMax} onChange={e => setFreqMax(Number(e.target.value))} style={{ width: 90 }}>
            <option value={5000}>5 kHz</option>
            <option value={10000}>10 kHz</option>
            <option value={20000}>20 kHz</option>
            <option value={50000}>50 kHz</option>
          </select>
        </div>
        <div className="control-row-inline">
          <label>Window</label>
          <select value={windowType} onChange={e => setWindowType(e.target.value as WindowType)} style={{ width: 90 }}>
            {WINDOWS.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </div>

        <div className="section-title">Signal — {editIsCh2 ? 'CH2' : 'CH1'}</div>
        <div className="control-row-inline">
          <label>Frequency</label>
          <input type="number" min={10} max={20000} step={10}
            value={par.frequency}
            onChange={e => onParChange('frequency', Number(e.target.value))}
            style={{ width: 80 }} />
        </div>
        <div className="control-row-inline">
          <label>Amplitude</label>
          <input type="number" min={0.1} max={2.5} step={0.1}
            value={par.amplitude}
            onChange={e => onParChange('amplitude', Number(e.target.value))}
            style={{ width: 80 }} />
        </div>
        {par.waveType === 'square' && (
          <div className="control-row">
            <div className="control-row-inline" style={{ marginBottom: 2 }}>
              <label>Duty Cycle</label>
              <span className="value-badge">{par.dutyCycle}%</span>
            </div>
            <input type="range" min={1} max={99}
              value={par.dutyCycle}
              onChange={e => onParChange('dutyCycle', Number(e.target.value))} />
          </div>
        )}

        <div className="section-title learning-title">⚗ Learning Mode</div>
        <div className="control-row">
          <div className="control-row-inline" style={{ marginBottom: 2 }}>
            <label>ADC Bit Depth</label>
            <span className="value-badge" style={{ color: '#ff8844' }}>{bits}-bit</span>
          </div>
          <div className="bit-depth-selector">
            {BIT_DEPTHS.map(b => (
              <button key={b} className={bits === b ? 'active' : ''} onClick={() => setBits(b)}>
                {b}-bit
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 3 }}>
            SNR ≈ {snrDb} dB
          </div>
        </div>

        <div className="control-row" style={{ borderTop: '1px solid #333', paddingTop: 8, marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={persistence} onChange={e => setPersistence(e.target.checked)} disabled={channel === 'both'} />
            <span style={{ color: persistence && channel !== 'both' ? '#f0a030' : 'var(--text-label)' }}>
              Persistence ({PERSIST_DEPTH} frames)
            </span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAvg} onChange={e => setShowAvg(e.target.checked)} disabled={channel === 'both'} />
            <span style={{ color: showAvg && channel !== 'both' ? '#44aaff' : 'var(--text-label)' }}>
              Running average
            </span>
          </label>
          {showAvg && channel !== 'both' && avgCountRef.current > 1 && (
            <div style={{ fontSize: 10, color: '#44aaff', marginTop: 3 }}>
              n = {avgCountRef.current} frames
            </div>
          )}
        </div>

        <div className="control-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={showTheory} onChange={e => setShowTheory(e.target.checked)} disabled={channel === 'both'} />
            Show theoretical spectrum ◆
          </label>
        </div>

        <div className="section-title">Marker</div>
        {markerFreq !== null && markerAmp !== null ? (
          <div style={{ fontSize: 11, lineHeight: 1.8, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
            <div>M1 freq: <span style={{ color: 'var(--ch1-color)' }}>{(markerFreq / 1000).toFixed(3)} kHz</span></div>
            <div>M1 amp:  <span style={{ color: 'var(--ch1-color)' }}>{markerAmp.toFixed(2)} dBFS</span></div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>No signal</div>
        )}
      </div>
    </div>
  )
}
