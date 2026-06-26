import { useState, useMemo, useEffect, useRef } from 'react'
import { SignalParams, WaveType } from './core/signal'
import { DEFAULT_CHANNELS, resolveChannelSamples, ChannelInputs } from './core/scope'
import { toCircuit, type Schematic } from './core/schematic'
import SignalGenerator from './components/SignalGenerator'
import SpectrumAnalyzer from './components/SpectrumAnalyzer'
import Oscilloscope from './components/Oscilloscope'
import NetworkAnalyzer from './components/NetworkAnalyzer'
import SchematicEditor from './components/SchematicEditor'
import Voltmeter from './components/Voltmeter'
import SpiceDevPanel from './components/SpiceDevPanel'
import './App.css'

// SPICE-1 throwaway dev affordance. Set false (or remove the nav entry) once LOOP-1
// builds the real circuit UI. See docs/specs/schematic-ngspice.md.
const SHOW_SPICE_DEV = true

type ActiveInstrument = 'siggen' | 'spectrum' | 'scope' | 'network' | 'schematic' | 'voltmeter' | 'spice'
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
// CH2 is enabled (OSC-2). samplingRate is kept equal to CH1 so the time axes align.
const DEFAULT_PARAMS2: SignalParams = {
  waveType: 'sine',
  frequency: 2000,
  amplitude: 0.5,
  offset: 0,
  dutyCycle: 50,
  samplingRate: 100000,
  duration: 0.016,
}

const CIRCUIT_KEY = 'm2k-circuit-v1'

// Restore the last-edited circuit from localStorage (autosave), else start empty.
function loadStoredSchematic(): Schematic {
  try {
    const raw = localStorage.getItem(CIRCUIT_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      if (Array.isArray(d.components) && Array.isArray(d.wires)) return { components: d.components, wires: d.wires }
    }
  } catch { /* ignore corrupt storage */ }
  return { components: [], wires: [] }
}

export default function App() {
  const [active, setActive] = useState<ActiveInstrument>('siggen')
  const [layout, setLayout] = useState<LayoutMode>('single')
  const [params, setParams] = useState<SignalParams>(DEFAULT_PARAMS)
  const [params2, setParams2] = useState<SignalParams>(DEFAULT_PARAMS2)
  const [channels] = useState(DEFAULT_CHANNELS)
  const [running, setRunning] = useState(true)
  // Drawn circuit shared by the Schematic editor, Network Analyzer and Voltmeter.
  const [schematic, setSchematic] = useState<Schematic>(loadStoredSchematic)
  const [tick, setTick] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!running) return
    let frameCount = 0
    const loop = () => {
      frameCount++
      if (frameCount % 6 === 0) setTick(t => t + 1)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [running])

  // Autosave the drawn circuit so a refresh / cache-clear does not lose work.
  useEffect(() => {
    try { localStorage.setItem(CIRCUIT_KEY, JSON.stringify(schematic)) } catch { /* quota */ }
  }, [schematic])

  const channelInputs = useMemo<ChannelInputs>(() => ({
    generatorParams: params,
    generator2Params: params2,
    circuitOut: null,
  }), [params, params2])

  const channelSignals = useMemo(() => {
    if (!running) return { CH1: null, CH2: null }
    void tick
    return {
      CH1: resolveChannelSamples(channels.CH1, channelInputs),
      CH2: resolveChannelSamples(channels.CH2, channelInputs),
    }
  }, [channels, channelInputs, running, tick])

  const signal = channelSignals.CH1
  const signal2 = useMemo(() => {
    if (!running) return null
    void tick
    return resolveChannelSamples({ id: 'CH2', enabled: true, source: { kind: 'generator2' } }, channelInputs)
  }, [running, channelInputs, tick])

  // The drawn circuit (memoised) — Network Analyzer sweeps it when valid; Voltmeter reads it.
  const drawn = useMemo(() => toCircuit(schematic, 'Drawn circuit'), [schematic])
  const drawnValid = drawn.warnings.length === 0

  function updateParam<K extends keyof SignalParams>(key: K, value: SignalParams[K]) {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="app-shell">
      <nav className="nav-panel">
        <div className="nav-logo">M2K</div>

        <button className={`nav-btn ${active === 'siggen' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('siggen'); setLayout('single') }} title="Signal Generator">
          <span className="nav-icon">&#9095;</span><span className="nav-label">Signal<br/>Gen</span>
        </button>

        <button className={`nav-btn ${active === 'scope' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('scope'); setLayout('single') }} title="Oscilloscope">
          <span className="nav-icon">&#8767;</span><span className="nav-label">Scope</span>
        </button>

        <button className={`nav-btn ${active === 'spectrum' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('spectrum'); setLayout('single') }} title="Spectrum Analyzer">
          <span className="nav-icon">&#9650;</span><span className="nav-label">Spectrum</span>
        </button>

        <button className={`nav-btn ${active === 'network' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('network'); setLayout('single') }} title="Network Analyzer (Bode)">
          <span className="nav-icon">&#9678;</span><span className="nav-label">Network</span>
        </button>

        <button className={`nav-btn ${active === 'voltmeter' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('voltmeter'); setLayout('single') }} title="Voltmeter (DC)">
          <span className="nav-icon">&#8487;</span><span className="nav-label">Voltmeter</span>
        </button>

        <button className={`nav-btn ${active === 'schematic' && layout === 'single' ? 'nav-active' : ''}`}
          onClick={() => { setActive('schematic'); setLayout('single') }} title="Schematic Editor">
          <span className="nav-icon">&#9636;</span><span className="nav-label">Circuit</span>
        </button>

        <button className={`nav-btn ${layout === 'split' ? 'nav-active' : ''}`}
          onClick={() => setLayout(l => l === 'split' ? 'single' : 'split')} title="Split view: Signal Gen + Spectrum">
          <span className="nav-icon">&#8863;</span><span className="nav-label">Split<br/>View</span>
        </button>

        {SHOW_SPICE_DEV && (
          <button className={`nav-btn ${active === 'spice' && layout === 'single' ? 'nav-active' : ''}`}
            onClick={() => { setActive('spice'); setLayout('single') }} title="SPICE engine check (dev)">
            <span className="nav-icon">&#9707;</span><span className="nav-label">SPICE<br/>dev</span>
          </button>
        )}
      </nav>

      <main className={`instrument-area ${layout === 'split' ? 'split' : ''}`}>
        {layout === 'single' && active === 'scope' ? (
          <Oscilloscope
            params={params}
            signal={signal}
            signal2={signal2}
            params2={params2}
            running={running}
            onRunToggle={() => setRunning(r => !r)}
            onParams2Change={(k, v) => setParams2(prev => ({ ...prev, [k]: v }))}
          />
        ) : layout === 'single' && active === 'schematic' ? (
          <SchematicEditor schematic={schematic} setSchematic={setSchematic} />
        ) : layout === 'single' && active === 'network' ? (
          <NetworkAnalyzer
            circuit={drawnValid ? drawn.circuit : undefined}
            dutName={drawnValid ? 'your drawn circuit' : undefined}
          />
        ) : layout === 'single' && active === 'voltmeter' ? (
          <Voltmeter circuit={drawn.circuit} w1={params} w2={params2} />
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
