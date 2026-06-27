import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
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
import Quickstart from './components/Quickstart'
import { EXAMPLES } from './core/examples'
import { type BoardLayout, PLACEABLE_KINDS, DIP_KINDS } from './core/breadboard'
import Voltmeter from './components/Voltmeter'
import PowerSupply from './components/PowerSupply'
import './App.css'

type ActiveInstrument = 'siggen' | 'spectrum' | 'scope' | 'network' | 'schematic' | 'voltmeter' | 'psu' | 'breadboard' | 'about' | 'quickstart'

// E-1: preset lab layouts. A workspace is an ordered list of instrument panels plus an
// arrangement hint; CSS grid/flex in `.instrument-area` lays them out. Single-instrument view is
// just a one-panel workspace. No drag-docking (that's E-2) and no new dependency.
type Arrange = 'single' | 'row' | 'grid'
// Layouts are described by what they show, not by a course/lab — anyone can use the twin.
interface Preset { id: string; name: string; panels: ActiveInstrument[]; arrange: Arrange }
const PRESETS: Preset[] = [
  { id: 'gen-spectrum', name: 'Generator + Spectrum', panels: ['siggen', 'spectrum'], arrange: 'row' },
  { id: 'gen-scope', name: 'Generator + Scope', panels: ['siggen', 'scope'], arrange: 'row' },
  { id: 'circuit-bode', name: 'Circuit + Network (Bode)', panels: ['schematic', 'network'], arrange: 'row' },
  { id: 'circuit-scope', name: 'Circuit + Scope', panels: ['schematic', 'scope'], arrange: 'row' },
  { id: 'bench', name: 'Scope + Supply + Voltmeter', panels: ['scope', 'psu', 'voltmeter'], arrange: 'grid' },
]
const WORKSPACE_KEY = 'm2k-workspace-v1'

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
  const stored0 = (() => {
    try { const r = localStorage.getItem(WORKSPACE_KEY); if (r) return JSON.parse(r) as { active?: ActiveInstrument; presetId?: string | null } } catch { /* ignore */ }
    return {}
  })()
  // `presetId` null → single-instrument view of `active`; otherwise a multi-panel preset.
  const [active, setActive] = useState<ActiveInstrument>(stored0.active ?? 'siggen')
  // Once the user has opened the Quickstart, gold-highlight its nav button whenever they are
  // elsewhere, so the way back to the guide is always obvious (its steps send you to other panels).
  const [quickstartSeen, setQuickstartSeen] = useState(false)
  useEffect(() => { if (active === 'quickstart') setQuickstartSeen(true) }, [active])
  const [presetId, setPresetId] = useState<string | null>(stored0.presetId ?? null)
  const [entered, setEntered] = useState<boolean>(() => {
    try { return localStorage.getItem('bm2k-welcomed') === '1' } catch { return false }
  })
  const [params, setParams] = useState<SignalParams>(DEFAULT_PARAMS)
  const [params2, setParams2] = useState<SignalParams>(DEFAULT_PARAMS2)
  const [psu, setPsu] = useState<SupplySettings>(DEFAULT_PSU)
  const [channels] = useState(DEFAULT_CHANNELS)
  const [running, setRunning] = useState(true)
  const [schematic, setSchematic] = useState<Schematic>(loadStoredSchematic)
  const [board, setBoard] = useState<BoardLayout>(loadStoredBoard)

  // Shared schematic undo/redo history (one stack owned here, so every editor of the schematic —
  // the Circuit editor and the Board tab's lab load — pushes to the same history). Callers snapshot
  // explicitly before a discrete edit; setSchematic itself stays raw (drags must not flood history).
  const schematicRef = useRef(schematic); schematicRef.current = schematic
  const histPast = useRef<Schematic[]>([])
  const histFuture = useRef<Schematic[]>([])
  const HIST_MAX = 100
  function snapshotSchematic() {
    histPast.current.push(schematicRef.current)
    if (histPast.current.length > HIST_MAX) histPast.current.shift()
    histFuture.current = []
  }
  function undoSchematic() {
    if (!histPast.current.length) return
    histFuture.current.push(schematicRef.current)
    setSchematic(histPast.current.pop()!)
  }
  function redoSchematic() {
    if (!histFuture.current.length) return
    histPast.current.push(schematicRef.current)
    setSchematic(histFuture.current.pop()!)
  }
  // One-shot scope request: an example sets this on load (XY mode + Volts/div framing for I-V
  // curves); the Oscilloscope consumes it and clears it. null = nothing pending.
  const [scopeReq, setScopeReq] = useState<{ xy: boolean; ch1Vdiv?: number; ch2Vdiv?: number } | null>(null)
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

  // Keep the breadboard in sync with the schematic: when parts are cleared/loaded/deleted, drop
  // board parts whose id no longer exists. If that empties the board (e.g. Clear or a brand-new
  // circuit was loaded), reset jumpers + ports too so the board starts fresh for the new circuit.
  useEffect(() => {
    const valid = new Set(
      schematic.components.filter((c) => PLACEABLE_KINDS.has(c.kind) || DIP_KINDS.has(c.kind)).map((c) => c.id),
    )
    setBoard((b) => {
      const parts = b.parts.filter((p) => valid.has(p.id))
      const dips = (b.dips ?? []).filter((d) => valid.has(d.id))
      if (parts.length === b.parts.length && dips.length === (b.dips ?? []).length) return b // nothing stale
      return parts.length === 0 && dips.length === 0 ? { parts: [], jumpers: [], ports: [], dips: [] } : { ...b, parts, dips }
    })
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

  // Sample a scope channel, differentially when a 1-/2- reference probe is placed (pos − neg),
  // else single-ended (pos to ground). Lets a diode I-V read true V across the device.
  const sampleDiff = (res: Parameters<typeof sampleNodeTransient>[0], pos: string, neg: string | undefined, grid: Float64Array) => {
    const a = sampleNodeTransient(res, pos, grid)
    if (!a || !neg) return a
    const b = sampleNodeTransient(res, neg, grid)
    if (!b) return a
    const o = new Float64Array(a.length)
    for (let i = 0; i < a.length; i++) o[i] = a[i] - b[i]
    return o
  }
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
        const x1 = sampleDiff(res, drawn.probes.ch1 ?? 'out', drawn.probes.ch1n, sampleTimes)
        setCircuitOut(x1 ? { t: grid, x: x1 } : null)
        const x2 = drawn.probes.ch2 ? sampleDiff(res, drawn.probes.ch2, drawn.probes.ch2n, sampleTimes) : null
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
  const circuitActive = drawnValid && circuitOut !== null
  // CH2 follows the circuit when one is active: its 2+ probe (circuitOut2), or nothing if no 2+
  // probe is placed — an unconnected scope input reads nothing, not the W2 generator. Only the
  // standalone (no-circuit) view shows W2 on CH2.
  const measured2 = circuitActive ? circuitOut2 : signal2

  // Clip detection: warn when the simulated output rides into the supply rails. The op-amp model
  // clamps to its V+/V- pins, so a too-big input (e.g. 1 V into a gain-10 amp) flat-tops at ±5 V.
  // Rails come from the circuit's dcrails (the V+/V- parts), falling back to the PSU setting.
  const outputClipping = useMemo(() => {
    if (!circuitActive || !circuitOut) return false
    const rails = drawn.circuit.components.flatMap((c) => (c.kind === 'dcrail' ? [c.volts] : []))
    const hi = rails.length ? Math.max(...rails) : psu.plus
    const lo = rails.length ? Math.min(...rails) : psu.minus
    let mx = -Infinity, mn = Infinity
    for (const v of circuitOut.x) { if (v > mx) mx = v; if (v < mn) mn = v }
    const m = 0.02 * Math.max(Math.abs(hi), Math.abs(lo), 1) // within 2% of a rail = clipping
    return mx >= hi - m || mn <= lo + m
  }, [circuitActive, circuitOut, drawn, psu])

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
        const x1 = sampleDiff(res, drawn.probes.ch1 ?? 'out', drawn.probes.ch1n, sampGrid)
        setScopeOut1(x1 ? { t: tGrid, x: x1 } : null)
        const x2 = drawn.probes.ch2 ? sampleDiff(res, drawn.probes.ch2, drawn.probes.ch2n, sampGrid) : null
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

  // Persist the chosen workspace (geometry layer only — instrument settings stay component-local).
  useEffect(() => {
    try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ active, presetId })) } catch { /* quota */ }
  }, [active, presetId])

  const preset = presetId ? PRESETS.find((p) => p.id === presetId) ?? null : null
  const panels: ActiveInstrument[] = preset ? preset.panels : [active]
  const arrange: Arrange = preset ? preset.arrange : 'single'
  const multi = panels.length > 1

  const navBtn = (id: ActiveInstrument, icon: string, label: React.ReactNode, title: string, hint = false) => (
    <button className={`nav-btn ${active === id && !presetId ? 'nav-active' : ''} ${hint ? 'nav-hint' : ''}`}
      onClick={() => { setActive(id); setPresetId(null) }} title={title}>
      <span className="nav-icon">{icon}</span><span className="nav-label">{label}</span>
    </button>
  )

  // Load a built-in example by id (used by the Quickstart's step buttons). Mirrors the Circuit
  // editor's Examples dropdown: snapshot for undo, swap the schematic, reset both generators
  // (defaults + the example's presets), and request the scope's XY/Volts-div framing.
  function loadExample(id: string) {
    const ex = EXAMPLES.find((x) => x.id === id)
    if (!ex) return
    snapshotSchematic()
    setSchematic(JSON.parse(JSON.stringify(ex.schematic)))
    setParams({ ...DEFAULT_PARAMS, ...ex.w1 })
    setParams2({ ...DEFAULT_PARAMS2, ...ex.w2 })
    setScopeReq({ xy: !!ex.xy, ch1Vdiv: ex.ch1Vdiv, ch2Vdiv: ex.ch2Vdiv })
  }

  // One instrument panel by id. `multi` (more than one visible) drives the `compact` prop on the
  // instruments that support it. Pure function of props + each instrument's local state.
  function renderPanel(id: ActiveInstrument): React.ReactNode {
    switch (id) {
      case 'scope':
        return <Oscilloscope params={params} signal={scopeSig1} signal2={scopeSig2} params2={params2}
          running={running} circuitActive={circuitActive} outputClipping={outputClipping}
          circuitFs={scopeCircuitFs} onWindowSecChange={setScopeWinSec} compact={multi}
          scopeReq={scopeReq} onScopeApplied={() => setScopeReq(null)}
          onRunToggle={() => setRunning(r => !r)} onParams2Change={(k, v) => setParams2(prev => ({ ...prev, [k]: v }))} />
      case 'schematic':
        return <SchematicEditor schematic={schematic} setSchematic={setSchematic}
          snapshot={snapshotSchematic} undo={undoSchematic} redo={redoSchematic}
          onLoadGenerators={(w1, w2) => { if (w1) setParams({ ...DEFAULT_PARAMS, ...w1 }); setParams2(w2 ? { ...DEFAULT_PARAMS2, ...w2 } : DEFAULT_PARAMS2) }}
          onLoadScope={(req) => setScopeReq(req)} />
      case 'breadboard':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
            <div className="stacked-pane"><SchematicEditor schematic={schematic} setSchematic={setSchematic}
              snapshot={snapshotSchematic} undo={undoSchematic} redo={redoSchematic}
              onLoadGenerators={(w1, w2) => { if (w1) setParams({ ...DEFAULT_PARAMS, ...w1 }); setParams2(w2 ? { ...DEFAULT_PARAMS2, ...w2 } : DEFAULT_PARAMS2) }}
          onLoadScope={(req) => setScopeReq(req)} /></div>
            <div className="stacked-pane"><Breadboard schematic={schematic} setSchematic={setSchematic} board={board} setBoard={setBoard}
              snapshotSchematic={snapshotSchematic}
              generators={{ w1: params, w2: params2 }}
              onLoadGenerators={(w1, w2) => { setParams({ ...DEFAULT_PARAMS, ...w1 }); setParams2({ ...DEFAULT_PARAMS2, ...w2 }) }} /></div>
          </div>
        )
      case 'network':
        return <NetworkAnalyzer circuit={drawnValid ? drawn.circuit : undefined} dutName={drawnValid ? 'your drawn circuit' : undefined}
          probes={drawnValid ? drawn.probes : undefined} tunables={tunables} onTune={tuneComponent} />
      case 'voltmeter':
        return <Voltmeter circuit={drawn.circuit} probes={drawn.probes} w1={params} w2={params2} psu={psu} />
      case 'psu':
        return <PowerSupply psu={psu} onChange={setPsu} circuit={drawn.circuit} w1={params} w2={params2} />
      case 'about':
        return <About />
      case 'quickstart':
        return <Quickstart
          onGoTo={(t) => { setActive(t as ActiveInstrument); setPresetId(null) }}
          onLoadExample={loadExample} />
      case 'siggen':
        return <SignalGenerator params={params} params2={params2} signal={signal} signal2={signal2} running={running} compact={multi}
          onParamChange={updateParam} onParam2Change={(k, v) => setParams2(prev => ({ ...prev, [k]: v }))}
          onWaveTypeChange={(w: WaveType) => updateParam('waveType', w)}
          onRunToggle={() => setRunning(r => !r)} />
      case 'spectrum':
        return <SpectrumAnalyzer params={params} signal={measured} params2={params2} signal2={measured2}
          running={running} compact={multi} onParamChange={updateParam}
          onParam2Change={(k, v) => setParams2(prev => ({ ...prev, [k]: v }))} onRunToggle={() => setRunning(r => !r)} />
    }
  }

  if (!entered) {
    return <Welcome
      onEnter={() => { try { localStorage.setItem('bm2k-welcomed', '1') } catch { /* quota */ } setEntered(true) }}
      onQuickstart={() => { try { localStorage.setItem('bm2k-welcomed', '1') } catch { /* quota */ } setActive('quickstart'); setPresetId(null); setEntered(true) }} />
  }

  return (
    <div className="app-shell">
      <nav className="nav-panel">
        <div className="nav-logo" onClick={() => setEntered(false)} title="Welcome" style={{ cursor: 'pointer' }}><img src={`${import.meta.env.BASE_URL}bridgem2k.svg`} alt="BridgeM2K" style={{ width: 48, height: 48, display: "block", margin: "0 auto" }} /></div>
        {navBtn('quickstart', '▷', <>Quick<br/>start</>, 'Quickstart — new here? Start with this', quickstartSeen && active !== 'quickstart' && !presetId)}
        {navBtn('siggen', '⌇', <>Signal<br/>Gen</>, 'Signal Generator')}
        {navBtn('scope', '∿', 'Scope', 'Oscilloscope')}
        {navBtn('spectrum', '▲', 'Spectrum', 'Spectrum Analyzer')}
        {navBtn('network', '◎', 'Network', 'Network Analyzer (Bode)')}
        {navBtn('voltmeter', 'Ω', 'Voltmeter', 'Voltmeter (DC)')}
        {navBtn('psu', '∓', 'Supply', 'Power Supply')}
        {navBtn('schematic', '▤', 'Circuit', 'Schematic Editor')}
        {navBtn('breadboard', '∷', 'Board', 'Breadboard layout')}

        <div className="nav-sep">Layouts</div>
        <select className={`nav-layouts ${presetId ? 'nav-active' : ''}`} value={presetId ?? ''}
          onChange={(e) => setPresetId(e.target.value || null)} title="Multi-panel layouts">
          <option value="">Single view</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <button className={`nav-btn ${active === 'about' && !presetId ? 'nav-active' : ''}`}
          style={{ marginTop: 'auto' }}
          onClick={() => { setActive('about'); setPresetId(null) }} title="About & licenses">
          <span className="nav-icon">ⓘ</span><span className="nav-label">About</span>
        </button>
      </nav>

      <main className={`instrument-area arrange-${arrange}`}>
        {panels.map((id) => <Fragment key={id}>{renderPanel(id)}</Fragment>)}
      </main>
    </div>
  )
}
