import { useState, useMemo, useEffect, useRef } from 'react'
import { SignalParams, WaveType } from './core/signal'
import { DEFAULT_CHANNELS, resolveChannelSamples, ChannelInputs } from './core/scope'
import SignalGenerator from './components/SignalGenerator'
import SpectrumAnalyzer from './components/SpectrumAnalyzer'
import Oscilloscope from './components/Oscilloscope'
import NetworkAnalyzer from './components/NetworkAnalyzer'
import SpiceDevPanel from './components/SpiceDevPanel'
import './App.css'

// SPICE-1 throwaway dev affordance. Set false (or remove the nav entry) once LOOP-1
// builds the real circuit UI. See docs/specs/schematic-ngspice.md.
const SHOW_SPICE_DEV = true

type ActiveInstrument = 'siggen' | 'spectrum' | 'scope' | 'network' | 'spice'
type LayoutMode = 'single' | 'split'

const DEFAULT_PARAMS: SignalParams = {
  waveType: 'square',
  frequency: 1000,
  amplitude: 1,
  offset: 0,
  dutyCycle: 50,
  samplingRate: 100000,
  duration: 0.016,    // 16 ms — 16 periods at 1 kHz → Bluestein 1600-pt FFT, 62.5 Hz bins, zero leakage
}

// Second channel default (CH2) — a distinct sine so the two scope traces differ once
// CH2 is enabled (OSC-2). samplingRate is kept equal to CH1 so the time axes align;
// OSC-2 should enforce this equality when the UI can change it.
const DEFAULT_PARAMS2: SignalParams = {
  waveType: 'sine',
  frequency: 2000,
  amplitude: 0.5,
  offset: 0,
  dutyCycle: 50,
  samplingRate: 100000,
  duration: 0.016,
}

export default function App() {
  const [active, setActive] = useState<ActiveInstrument>('siggen')
  const [layout, setLayout] = useState<LayoutMode>('single')
  const [params, setParams] = useState<SignalParams>(DEFAULT_PARAMS)
  // CH2 generator params + channel bus. CH2 has no UI yet (enabled at OSC-2).
  const [params2] = useState<SignalParams>(DEFAULT_PARAMS2)
  const [channels] = useState(DEFAULT_CHANNELS)
  const [running, setRunning] = useState(true)
  // Tick counter forces signal recompute each frame so noise shimmers like a real SA
  const [tick, setTick] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!running) return
    let frameCount = 0
    const loop = () => {
      frameCount++
      // Recompute ~10 times/s (every 6 animation frames at 60 fps) to shimmer noise
      if (frameCount % 6 === 0) setTick(t => t + 1)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [running])

  // Channel inputs feeding the bus. circuitOut is null until the circuit loop (LOOP-1).
  const channelInputs = useMemo<ChannelInputs>(() => ({
    generatorParams: params,
    generator2Params: params2,
    circuitOut: null,
  }), [params, params2])

  // Resolve all channels each tick (tick drives the spectrum's noise shimmer).
  const channelSignals = useMemo(() => {
    if (!running) return { CH1: null, CH2: null }
    void tick   // depend on tick so the spectrum re-randomises each frame
    return {
      CH1: resolveChannelSamples(channels.CH1, channelInputs),
      CH2: resolveChannelSamples(channels.CH2, channelInputs),
    }
  }, [channels, channelInputs, running, tick])

  // CH1 is the existing generator signal; the current instruments consume it unchanged.
  const signal = channelSignals.CH1

  function updateParam<K extends keyof SignalParams>(key: K, value: SignalParams[K]) {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="app-shell">
      {/* Left navigation panel (Scopy-style) */}
      <nav className="nav-panel">
        <div className="nav-logo">M2K</div>

        <button
          className={`nav-btn ${active === 'siggen' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('siggen'); setLayout('single') }}
          title="Signal Generator"
        >
          <span className="nav-icon">&#9095;</span>
          <span className="nav-label">Signal<br/>Gen</span>
        </button>

        <button
          className={`nav-btn ${active === 'scope' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('scope'); setLayout('single') }}
          title="Oscilloscope"
        >
          <span className="nav-icon">&#8767;</span>
          <span className="nav-label">Scope</span>
        </button>

        <button
          className={`nav-btn ${active === 'spectrum' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('spectrum'); setLayout('single') }}
          title="Spectrum Analyzer"
        >
          <span className="nav-icon">&#9650;</span>
          <span className="nav-label">Spectrum</span>
        </button>

        <button
          className={`nav-btn ${active === 'network' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('network'); setLayout('single') }}
          title="Network Analyzer (Bode)"
        >
          <span className="nav-icon">&#9678;</span>
          <span className="nav-label">Network</span>
        </button>

        <button
          className={`nav-btn ${layout === 'split' ? 'nav-active' : ''}`}
          onClick={() => setLayout(l => l === 'split' ? 'single' : 'split')}
          title="Split view: Signal Gen + Spectrum"
        >
          <span className="nav-icon">&#8863;</span>
          <span className="nav-label">Split<br/>View</span>
        </button>

        {SHOW_SPICE_DEV && (
          <button
            className={`nav-btn ${active === 'spice' && layout === 'single' ? 'nav-active' : ''}`}
            onClick={() => { setActive('spice'); setLayout('single') }}
            title="SPICE engine check (dev)"
          >
            <span className="nav-icon">&#9707;</span>
            <span className="nav-label">SPICE<br/>dev</span>
          </button>
        )}
      </nav>

      {/* Main instrument area */}
      <main className={`instrument-area ${layout === 'split' ? 'split' : ''}`}>
        {layout === 'single' && active === 'scope' ? (
          <Oscilloscope
            params={params}
            signal={signal}
            running={running}
            onRunToggle={() => setRunning(r => !r)}
          />
        ) : layout === 'single' && active === 'network' ? (
          <NetworkAnalyzer />
        ) : layout === 'single' && active === 'spice' && SHOW_SPICE_DEV ? (
          <SpiceDevPanel />
        ) : (
          <>
            {(layout === 'split' || active === 'siggen') && (
              <SignalGenerator
                params={params}
                signal={signal}
                running={running}
                compact={layout === 'split'}
                onParamChange={updateParam}
                onWaveTypeChange={(w: WaveType) => updateParam('waveType', w)}
                onRunToggle={() => setRunning(r => !r)}
              />
            )}
            {(layout === 'split' || active === 'spectrum') && (
              <SpectrumAnalyzer
                params={params}
                signal={signal}
                running={running}
                compact={layout === 'split'}
                onParamChange={updateParam}
                onRunToggle={() => setRunning(r => !r)}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
