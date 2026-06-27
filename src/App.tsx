import { useState, useMemo, useEffect, useRef } from 'react'
import { SignalParams, WaveType, generateSignal } from './core/signal'
import { DEFAULT_CHANNELS, resolveChannelSamples, ChannelInputs, type Samples } from './core/scope'
import { toCircuit, type Schematic } from './core/schematic'
import { type SupplySettings, buildNetlist, applyGeneratorParams } from './core/netlist'
import { createSpiceEngine, type SpiceEngine, sampleNodeTransient } from './core/spice'
import SignalGenerator from './components/SignalGenerator'
import SpectrumAnalyzer from './components/SpectrumAnalyzer'
import Oscilloscope from './components/Oscilloscope'
import NetworkAnalyzer from './components/NetworkAnalyzer'
import SchematicEditor from './components/SchematicEditor'
import Breadboard from './components/Breadboard'
import About from './components/About'
import Welcome from './components/Welcome'
import { type BoardLayout } from './core/breadboard'
import Voltmeter from './components/Voltmeter'
import PowerSupply from './components/PowerSupply'
import './App.css'

type ActiveInstrument = 'siggen' | 'spectrum' | 'scope' | 'network' | 'schematic' | 'voltmeter' | 'psu' | 'breadboard' | 'about'
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

const DEFAULT_PARAMS2: SignalParams = {
  waveType: 'sine',
  frequency: 2000,
  amplitude: 0.5,
  offset: 0,
  dutyCycle: 50,
  samplingRate: 100000,
  duration: 0.016,
}

const DEFAULT_PSU: SupplySettings = { plus: 5, minus: -5, plusEnabled: true, minusEnabled: true }

const CIRCUIT_KEY = 'm2k-circuit-v1'

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

const BOARD_KEY = 'm2k-board-v1'

function loadStoredBoard(): BoardLayout {
  try {
    const raw = localStorage.getItem(BOARD_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      if (Array.isArray(d.parts) && Array.isArray(d.jumpers) && Array.isArray(d.ports)) return d
    }
  } catch { /* ignore corrupt storage */ }
  return { parts: [], jumpers: [], ports: [] }
}

export default function App() {
  const [active, setActive] = useState<ActiveInstrument>('siggen')
  const [entered, setEntered] = useState<boolean>(() => {
    try { return localStorage.getItem('bm2k-welcomed') === '1' } catch { return false }
  })
  const [layout, setLayout] = useState<LayoutMode>('single')
  const [params, setParams] = useState<SignalParams>(DEFAULT_PARAMS)
  const [params2, setParams2] = useState<SignalParams>(DEFAULT_PARAMS2)
  const [psu, setPsu] = useState<SupplySettings>(DEFAULT_PSU)
  const [channels] = useState(DEFAULT_CHANNELS)
  const [running, setRunning] = useState(true)
  const [schematic, setSchematic] = useState<Schematic>(loadStoredSchematic)
  const [board, setBoard] = useState<BoardLayout>(loadStoredBoard)
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

  useEffect(() => {
    try { localStorage.setItem(CIRCUIT_KEY, JSON.stringify(schematic)) } catch { /* quota */ }
  }, [schematic])

  useEffect(() => {
    try { localStorage.setItem(BOARD_KEY, JSON.stringify(board)) } catch { /* quota */ }
  }, [board])

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

  const drawn = useMemo(() => toCircuit(schematic, 'Drawn circuit'), [schematic])
  const drawnValid = drawn.warnings.length === 0

  // NA-TUNE: the drawn circuit's tunable parts (R/C/L) + a setter, so the Network Analyzer can
  // host live tuning knobs next to the Bode plot. Editing here flows back into the schematic,
  // which re-derives `drawn` and re-runs the (debounced) sweep.
  const tunables = useMemo(
    () => schematic.components
      .filter((c) => c.kind === 'resistor' || c.kind === 'capacitor' || c.kind === 'inductor')
      .map((c) => ({ id: c.id, kind: c.kind, value: c.value ?? 0 })),
    [schematic],
  )
  function tuneComponent(id: string, value: number) {
    setSchematic((s) => ({ ...s, components: s.components.map((c) => c.id === id ? { ...c, value } : c) }))
  }

  // WIRE-3: drive the drawn circuit with the generator and read its output back into the
  // scope/spectrum. circuitOut holds the resampled 1+ node voltage; null when no valid circuit.
  const [circuitOut, setCircuitOut] = useState<Samples | null>(null)
  const [circuitOut2, setCircuitOut2] = useState<Samples | null>(null)
  const spiceRef = useRef<SpiceEngine | null>(null)

  useEffect(() => {
    spiceRef.current = createSpiceEngine()
    return () => { spiceRef.current?.dispose(); spiceRef.current = null }
  }, [])

  useEffect(() => {
    if (!drawnValid) { setCircuitOut(null); setCircuitOut2(null); return }
    let cancelled = false
    const handle = setTimeout(async () => {
      try {
        const grid = generateSignal(params).t
        const N = grid.length
        const span = N / params.samplingRate
        // capture the SECOND span so startup/RC transients have settled (near steady state)
        const sampleTimes = new Float64Array(N)
        for (let k = 0; k < N; k++) sampleTimes[k] = grid[k] + span
        const ckt = applyGeneratorParams(drawn.circuit, params, params2)
        const nl = buildNetlist(ckt, { kind: 'tran', step: span / (N * 2), stop: 2 * span })
        const res = await spiceRef.current!.run(nl)
        if (cancelled) return
        const x1 = sampleNodeTransient(res, drawn.probes.ch1 ?? 'out', sampleTimes)
        setCircuitOut(x1 ? { t: grid, x: x1 } : null)
        const x2 = drawn.probes.ch2 ? sampleNodeTransient(res, drawn.probes.ch2, sampleTimes) : null
        setCircuitOut2(x2 ? { t: grid, x: x2 } : null)
      } catch {
        if (!cancelled) setCircuitOut(null)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [drawnValid, drawn, params, params2])

  // Two-tier: a scope/spectrum input wired through a circuit reads the .tran; otherwise the
  // exact generator output (preserving the signal pipeline + the 12-bit canary).
  const measured = drawnValid && circuitOut ? circuitOut : signal
  const measured2 = drawnValid && circuitOut2 ? circuitOut2 : signal2

  const circuitActive = drawnValid && circuitOut !== null

  // SCOPE-CKT-LONG: for long scope timebases (window longer than one generator span), run a
  // separate coarser/longer .tran sized to the scope window so the circuit output fills the
  // screen. Short windows reuse `measured` (the fine 16 ms buffer above); this only fires when
  // the scope asks for more than that buffer can cover.
  const [scopeWinSec, setScopeWinSec] = useState(0.01)
  const [scopeOut1, setScopeOut1] = useState<Samples | null>(null)
  const [scopeOut2, setScopeOut2] = useState<Samples | null>(null)
  const [scopeFs, setScopeFs] = useState(params.samplingRate)

  useEffect(() => {
    if (!circuitActive) { setScopeOut1(null); setScopeOut2(null); return }
    const genSpan = generateSignal(params).t.length / params.samplingRate
    if (scopeWinSec <= genSpan) { setScopeOut1(null); setScopeOut2(null); return }
    let cancelled = false
    const handle = setTimeout(async () => {
      try {
        const capSec = scopeWinSec * 2.2
        const fs = Math.min(params.samplingRate, Math.max(2000, Math.floor(200000 / capSec)))
        const settle = Math.max(genSpan, 3 / params.frequency) // let startup transients decay
        const stop = settle + capSec
        const step = Math.max(capSec / 200000, 1 / (params.frequency * 40)) // resolve the drive, cap points
        const ckt = applyGeneratorParams(drawn.circuit, params, params2)
        const res = await spiceRef.current!.run(buildNetlist(ckt, { kind: 'tran', step, stop }))
        if (cancelled) return
        const Nn = Math.round(capSec * fs)
        const tGrid = new Float64Array(Nn)
        const sampGrid = new Float64Array(Nn)
        for (let k = 0; k < Nn; k++) { tGrid[k] = k / fs; sampGrid[k] = settle + k / fs }
        const x1 = sampleNodeTransient(res, drawn.probes.ch1 ?? 'out', sampGrid)
        setScopeOut1(x1 ? { t: tGrid, x: x1 } : null)
        const x2 = drawn.probes.ch2 ? sampleNodeTransient(res, drawn.probes.ch2, sampGrid) : null
        setScopeOut2(x2 ? { t: tGrid, x: x2 } : null)
        setScopeFs(fs)
      } catch {
        if (!cancelled) { setScopeOut1(null); setScopeOut2(null) }
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(handle) }
  }, [circuitActive, drawn, params, params2, scopeWinSec])

  // What the scope shows: the long circuit buffer when present, else the standard `measured`.
  const scopeSig1 = circuitActive ? (scopeOut1 ?? measured) : measured
  const scopeSig2 = circuitActive ? (scopeOut2 ?? measured2) : measured2
  const scopeCircuitFs = scopeOut1 ? scopeFs : params.samplingRate

  function updateParam<K extends keyof SignalParams>(key: K, value: SignalParams[K]) {
    setParams(prev => ({ ...prev, [key]: value }))
  }

  const navBtn = (id: ActiveInstrument, icon: string, label: React.ReactNode, title: string) => (
    <button className={`nav-btn ${active === id && layout === 'single' ? 'nav-active' : ''}`}
      onClick={() => { setActive(id); setLayout('single') }} title={title}>
      <span className="nav-icon">{icon}</span><span className="nav-label">{label}</span>
    </button>
  )

  if (!entered) {
    return <Welcome onEnter={() => { try { localStorage.setItem('bm2k-welcomed', '1') } catch { /* quota */ } setEntered(true) }} />
  }

  return (
    <div className="app-shell">
      <nav className="nav-panel">
        <div className="nav-logo" onClick={() => setEntered(false)} title="Welcome" style={{ cursor: 'pointer' }}><img src={`${import.meta.env.BASE_URL}bridgem2k.svg`} alt="BridgeM2K" style={{ width: 48, height: 48, display: "block", margin: "0 auto" }} /></div>
        {navBtn('siggen', '⌇', <>Signal<br/>Gen</>, 'Signal Generator')}
        {navBtn('scope', '∿', 'Scope', 'Oscilloscope')}
        {navBtn('spectrum', '▲', 'Spectrum', 'Spectrum Analyzer')}
        {navBtn('network', '◎', 'Network', 'Network Analyzer (Bode)')}
        {navBtn('voltmeter', 'Ω', 'Voltmeter', 'Voltmeter (DC)')}
        {navBtn('psu', '∓', 'Supply', 'Power Supply')}
        {navBtn('schematic', '▤', 'Circuit', 'Schematic Editor')}
        {navBtn('breadboard', '∷', 'Board', 'Breadboard layout')}

        <button className={`nav-btn ${layout === 'split' ? 'nav-active' : ''}`}
          onClick={() => setLayout(l => l === 'split' ? 'single' : 'split')} title="Split view: Signal Gen + Spectrum">
          <span className="nav-icon">&#8863;</span><span className="nav-label">Split<br/>View</span>
        </button>

        <button className={`nav-btn ${active === 'about' && layout === 'single' ? 'nav-active' : ''}`}
          style={{ marginTop: 'auto' }}
          onClick={() => { setActive('about'); setLayout('single') }} title="About & licenses">
          <span className="nav-icon">ⓘ</span><span className="nav-label">About</span>
        </button>
      </nav>

      <main className={`instrument-area ${layout === 'split' ? 'split' : ''}`}>
        {layout === 'single' && active === 'scope' ? (
          <Oscilloscope
            params={params}
            signal={scopeSig1}
            signal2={scopeSig2}
            params2={params2}
            running={running}
            circuitActive={circuitActive}
            circuitFs={scopeCircuitFs}
            onWindowSecChange={setScopeWinSec}
            onRunToggle={() => setRunning(r => !r)}
            onParams2Change={(k, v) => setParams2(prev => ({ ...prev, [k]: v }))}
          />
        ) : layout === 'single' && active === 'schematic' ? (
          <SchematicEditor schematic={schematic} setSchematic={setSchematic} />
        ) : layout === 'single' && active === 'breadboard' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
            <div className="stacked-pane">
              <SchematicEditor schematic={schematic} setSchematic={setSchematic} />
            </div>
            <div className="stacked-pane">
              <Breadboard schematic={schematic} board={board} setBoard={setBoard} />
            </div>
          </div>
        ) : layout === 'single' && active === 'network' ? (
          <NetworkAnalyzer
            circuit={drawnValid ? drawn.circuit : undefined}
            dutName={drawnValid ? 'your drawn circuit' : undefined}
            probes={drawnValid ? drawn.probes : undefined}
            tunables={tunables}
            onTune={tuneComponent}
          />
        ) : layout === 'single' && active === 'voltmeter' ? (
          <Voltmeter circuit={drawn.circuit} w1={params} w2={params2} psu={psu} />
        ) : layout === 'single' && active === 'psu' ? (
          <PowerSupply psu={psu} onChange={setPsu} circuit={drawn.circuit} w1={params} w2={params2} />
        ) : layout === 'single' && active === 'about' ? (
          <About />
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
                signal={measured}
                params2={params2}
                signal2={measured2}
                running={running}
                compact={layout === 'split'}
                onParamChange={updateParam}
                onParam2Change={(k, v) => setParams2(prev => ({ ...prev, [k]: v }))}
                onRunToggle={() => setRunning(r => !r)}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
