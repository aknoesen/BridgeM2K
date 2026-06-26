// Schematic editor (SCH-1) — a lightweight node-and-wire editor (NOT KiCad). Place R/C/L/V/
// op-amp/ground/probe on a grid, draw wires, edit values. Produces a SPICE-2 Circuit via
// toCircuit(). See docs/specs/schematic-ngspice.md (SCH-1).
import { useMemo, useRef, useState, useEffect, type ReactElement, type Dispatch, type SetStateAction } from 'react'
import {
  Schematic, SchComponent, SchKind, terminalsOf, toCircuit,
} from '../core/schematic'
import { buildNetlist } from '../core/netlist'
import { createSpiceEngine, type SpiceEngine, transferFunction } from '../core/spice'
import './Instrument.css'

const GRID = 24
const PAD = 16

type Tool = 'select' | 'wire' | SchKind

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'select', label: 'Select' },
  { tool: 'wire', label: 'Wire' },
  { tool: 'resistor', label: 'R' },
  { tool: 'capacitor', label: 'C' },
  { tool: 'inductor', label: 'L' },
  { tool: 'opamp', label: 'Op-amp' },
  { tool: 'awg1', label: 'W1' },
  { tool: 'awg2', label: 'W2' },
  { tool: 'scope1', label: '1+' },
  { tool: 'adc1n', label: '1-' },
  { tool: 'scope2', label: '2+' },
  { tool: 'adc2n', label: '2-' },
  { tool: 'vplus', label: 'V+' },
  { tool: 'vminus', label: 'V-' },
  { tool: 'ground', label: 'GND' },
]

const UNIT: Partial<Record<SchKind, string>> = { resistor: 'Ω', capacitor: 'F', inductor: 'H', dcrail: 'V', vplus: 'V', vminus: 'V' }
const DEFAULT_VALUE: Partial<Record<SchKind, number>> = {
  resistor: 1000, capacitor: 1e-9, inductor: 1e-3, dcrail: 5, vplus: 5, vminus: -5,
}

// Parse engineering notation like "1k", "159n", "4.7u" → number.
function parseEng(s: string): number | undefined {
  const m = /^\s*(-?[\d.]+)\s*([pnumµkMG]?)\s*$/.exec(s)
  if (!m) return undefined
  const mult: Record<string, number> = {
    p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, '': 1, k: 1e3, M: 1e6, G: 1e9,
  }
  return parseFloat(m[1]) * mult[m[2]]
}
function fmtEng(x: number): string {
  if (x === 0) return '0'
  const units = [['G', 1e9], ['M', 1e6], ['k', 1e3], ['', 1], ['m', 1e-3], ['u', 1e-6], ['n', 1e-9], ['p', 1e-12]] as const
  for (const [suf, mul] of units) if (Math.abs(x) >= mul) return `${+(x / mul).toFixed(3)}${suf}`
  return String(x)
}

let idSeq = 1
const newId = (k: SchKind) => `${k[0].toUpperCase()}${idSeq++}`

interface EditorProps {
  schematic: Schematic
  setSchematic: Dispatch<SetStateAction<Schematic>>
}

export default function SchematicEditor({ schematic, setSchematic }: EditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const sch = schematic
  const setSch = setSchematic
  const [tool, setTool] = useState<Tool>('resistor')
  const [selected, setSelected] = useState<string | null>(null)
  const [wireStart, setWireStart] = useState<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<{ id: string; ox: number; oy: number } | null>(null)
  const [placeRotation, setPlaceRotation] = useState(0)
  const [simStatus, setSimStatus] = useState('')
  const [simBusy, setSimBusy] = useState(false)
  const engineRef = useRef<SpiceEngine | null>(null)
  const [hoverGrid, setHoverGrid] = useState<{ gx: number; gy: number } | null>(null)
  const [selectedWire, setSelectedWire] = useState<number | null>(null)

  const result = useMemo(() => toCircuit(sch, 'Schematic'), [sch])

  // Create the SPICE engine (worker) once for the Simulate action.
  useEffect(() => {
    engineRef.current = createSpiceEngine()
    return () => { engineRef.current?.dispose(); engineRef.current = null }
  }, [])

  // SCH-2: build the netlist from the drawing and run it through the engine.
  async function simulate() {
    if (result.warnings.length) { setSimStatus('Cannot simulate — ' + result.warnings.join(' ')); return }
    setSimBusy(true)
    setSimStatus('simulating…')
    try {
      const nl = buildNetlist(result.circuit, { kind: 'ac', sweep: 'dec', points: 30, fStart: 10, fStop: 1e6 })
      const res = await engineRef.current!.run(nl)
      let extra = ''
      try {
        const tf = transferFunction(res, 'out', 'in')
        const ref = tf.magDb[0]
        let fc: number | null = null
        for (let i = 1; i < tf.magDb.length; i++) {
          if (tf.magDb[i - 1] >= ref - 3 && tf.magDb[i] < ref - 3) { fc = tf.freq[i]; break }
        }
        if (fc) extra = ' · -3 dB ' + (fc >= 1000 ? (fc / 1000).toFixed(2) + ' kHz' : fc.toFixed(0) + ' Hz')
      } catch { /* not a simple low-pass — skip the cutoff readout */ }
      setSimStatus('OK — simulated ' + res.numPoints + ' points' + extra)
    } catch (e) {
      setSimStatus('engine error: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSimBusy(false)
    }
  }

  // Mouse position → snapped grid coordinates.
  function gridAt(e: React.MouseEvent): { gx: number; gy: number } {
    const r = svgRef.current!.getBoundingClientRect()
    return {
      gx: Math.max(0, Math.round((e.clientX - r.left - PAD) / GRID)),
      gy: Math.max(0, Math.round((e.clientY - r.top - PAD) / GRID)),
    }
  }

  function onBackgroundClick(e: React.MouseEvent) {
    const { gx, gy } = gridAt(e)
    setSelectedWire(null)
    if (tool === 'select') { setSelected(null); return }
    if (tool === 'wire') {
      if (!wireStart) setWireStart({ x: gx, y: gy })
      else {
        if (wireStart.x !== gx || wireStart.y !== gy) {
          setSch((s) => ({ ...s, wires: [...s.wires, { x1: wireStart.x, y1: wireStart.y, x2: gx, y2: gy }] }))
        }
        setWireStart(null)
      }
      return
    }
    // place a component
    const kind = tool as SchKind
    const c: SchComponent = { id: newId(kind), kind, gx, gy, rotation: placeRotation, value: DEFAULT_VALUE[kind] }
    setSch((s) => ({ ...s, components: [...s.components, c] }))
    setSelected(c.id)
  }

  function onComponentDown(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    setSelected(id) // clicking a placed part selects it in any tool (so R / Rotate act on it)
    setSelectedWire(null)
    if (tool !== 'select') return
    const { gx, gy } = gridAt(e)
    const c = sch.components.find((x) => x.id === id)!
    setDrag({ id, ox: gx - c.gx, oy: gy - c.gy })
  }
  function onWireClick(e: React.MouseEvent, i: number) {
    e.stopPropagation()
    if (tool === 'wire') return // don't select while drawing wires
    setSelectedWire(i)
    setSelected(null)
  }
  function onMouseMove(e: React.MouseEvent) {
    const { gx, gy } = gridAt(e)
    setHoverGrid({ gx, gy }) // live snap indicator for the wire tool
    if (!drag) return
    setSch((s) => ({
      ...s,
      components: s.components.map((c) => c.id === drag.id ? { ...c, gx: Math.max(0, gx - drag.ox), gy: Math.max(0, gy - drag.oy) } : c),
    }))
  }
  function onMouseUp() { setDrag(null) }

  function deleteSelected() {
    if (selectedWire !== null) {
      setSch((s) => ({ ...s, wires: s.wires.filter((_, i) => i !== selectedWire) }))
      setSelectedWire(null)
      return
    }
    if (!selected) return
    setSch((s) => ({ ...s, components: s.components.filter((c) => c.id !== selected) }))
    setSelected(null)
  }
  function rotate() {
    if (selected) {
      setSch((s) => ({ ...s, components: s.components.map((c) => c.id === selected ? { ...c, rotation: (((c.rotation ?? 0) + 1) % 4) } : c) }))
    } else {
      setPlaceRotation((r) => (r + 1) % 4)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return // don't hijack value typing
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selected || selectedWire !== null)) deleteSelected()
      else if (e.key === 'r' || e.key === 'R') rotate()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const sel = sch.components.find((c) => c.id === selected) || null

  function setSelValue(text: string) {
    const v = parseEng(text)
    if (v === undefined || !sel) return
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, value: v } : c) }))
  }

  const px = (g: number) => g * GRID + PAD

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Schematic Editor</span>
          <div className="display-controls">
            <button className="run-btn active" onClick={simulate} disabled={simBusy}>{simBusy ? 'Simulating…' : '▶ Simulate'}</button>
            <button className="run-btn" onClick={rotate}>Rotate (R)</button>
            <button className="run-btn" onClick={deleteSelected} disabled={!selected && selectedWire === null}>Delete</button>
            <button className="run-btn" onClick={() => { setSch({ components: [], wires: [] }); setSelected(null) }}>Clear</button>
          </div>
        </div>
        <svg
          ref={svgRef}
          className="plotly-display"
          style={{ background: 'var(--bg-display)', cursor: tool === 'select' ? 'default' : 'crosshair' }}
          onClick={onBackgroundClick}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
        >
          {/* grid dots */}
          <defs>
            <pattern id="gridDots" x={PAD} y={PAD} width={GRID} height={GRID} patternUnits="userSpaceOnUse">
              <circle cx={0} cy={0} r={1} fill="#333" />
            </pattern>
          </defs>
          <rect x={0} y={0} width="100%" height="100%" fill="url(#gridDots)" />

          {/* wires (thin visible line + a fat transparent hit area for easy clicking) */}
          {sch.wires.map((w, i) => (
            <g key={i}>
              <line x1={px(w.x1)} y1={px(w.y1)} x2={px(w.x2)} y2={px(w.y2)}
                stroke={selectedWire === i ? 'var(--accent-blue)' : 'var(--wire-color)'}
                strokeWidth={selectedWire === i ? 3 : 2} />
              <line x1={px(w.x1)} y1={px(w.y1)} x2={px(w.x2)} y2={px(w.y2)}
                stroke="transparent" strokeWidth={12}
                style={{ cursor: tool === 'wire' ? 'crosshair' : 'pointer', pointerEvents: tool === 'wire' ? 'none' : 'auto' }}
                onClick={(e) => onWireClick(e, i)} />
            </g>
          ))}

          {/* wire-in-progress: start marker + rubber-band to the snapped cursor point */}
          {wireStart && (
            <circle cx={px(wireStart.x)} cy={px(wireStart.y)} r={4} fill="none" stroke="var(--accent-blue)" strokeWidth={2} />
          )}
          {tool === 'wire' && wireStart && hoverGrid && (
            <line x1={px(wireStart.x)} y1={px(wireStart.y)} x2={px(hoverGrid.gx)} y2={px(hoverGrid.gy)}
              stroke="var(--accent-blue)" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />
          )}
          {/* live snap indicator: shows exactly which grid point the wire/part will land on */}
          {tool === 'wire' && hoverGrid && (
            <circle cx={px(hoverGrid.gx)} cy={px(hoverGrid.gy)} r={5} fill="none"
              stroke="var(--accent-blue)" strokeWidth={1.5} pointerEvents="none" />
          )}

          {/* components */}
          {sch.components.map((c) => (
            <g key={c.id} onMouseDown={(e) => onComponentDown(e, c.id)} onClick={(e) => e.stopPropagation()}
              style={{ cursor: tool === 'select' ? 'move' : 'pointer', pointerEvents: tool === 'wire' ? 'none' : 'auto' }}>
              {renderSymbol(c, px, c.id === selected)}
              {terminalsOf(c).map((t, i) => (
                <circle key={i} cx={px(t.gx)} cy={px(t.gy)} r={3} fill="var(--node-color)" />
              ))}
            </g>
          ))}
        </svg>
      </div>

      <div className="settings-panel">
        <div className="section-title">Tools</div>
        <div className="wave-selector">
          {TOOLS.map((t) => (
            <button key={t.tool} className={tool === t.tool ? 'active' : ''}
              onClick={() => { setTool(t.tool); setWireStart(null) }}>{t.label}</button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
          M2K pins — <b style={{ color: '#e0c020' }}>W1/W2</b> outputs, <b style={{ color: 'var(--ch1-color)' }}>1+/1-</b> Ch1 in,
          <b style={{ color: 'var(--ch2-color)' }}> 2+/2-</b> Ch2 in, <b style={{ color: '#e04040' }}>V+</b> /
          <b style={{ color: '#4a9eff' }}>V-</b> supply, <b style={{ color: '#cccccc' }}>GND</b>.
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          Place angle: {placeRotation * 90}° &nbsp;(press R to rotate; rotates selected part if one is selected)
        </div>

        <div className="section-title">Selected</div>
        {sel ? (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-primary)', marginBottom: 6 }}>
              {sel.id} ({sel.kind}) — {(sel.rotation ?? 0) * 90}°
            </div>
            <button className="run-btn" style={{ marginBottom: 8 }} onClick={rotate}>Rotate this part (R)</button>
            {UNIT[sel.kind] && (
              <div className="control-row-inline">
                <label>Value ({UNIT[sel.kind]})</label>
                <input type="text" defaultValue={fmtEng(sel.value ?? 0)} key={sel.id}
                  onBlur={(e) => setSelValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  style={{ width: 80 }} />
              </div>
            )}
          </div>
        ) : selectedWire !== null ? (
          <div style={{ fontSize: 11, color: 'var(--accent-blue)' }}>Wire selected — press Delete to remove</div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Nothing selected</div>
        )}

        <div className="section-title">Circuit</div>
        {result.warnings.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--theory-color)' }}>
            ✓ valid — {result.circuit.components.filter((c) => c.kind !== 'ground').length} parts
          </div>
        ) : (
          <ul style={{ fontSize: 11, color: '#ffaa55', margin: 0, paddingLeft: 16 }}>
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        {simStatus && (
          <div style={{ fontSize: 11, marginTop: 6, fontFamily: 'monospace', color: simStatus.startsWith('OK') ? 'var(--theory-color)' : '#ffaa55' }}>
            {simStatus}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8 }}>
          Tip: place parts, wire them, then press Simulate. Needs a V src, a Ground, and a
          Probe on the output. LOOP-1 plots the result in the Network Analyzer.
        </div>
      </div>
    </div>
  )
}

function renderSymbol(c: SchComponent, px: (g: number) => number, selected: boolean) {
  const stroke = selected ? 'var(--accent-blue)' : 'var(--ch1-color)'
  const sw = selected ? 2.5 : 1.8
  const ax = px(c.gx), ay = px(c.gy)
  const rot = (c.rotation ?? 0) * 90
  const G = (n: number) => n * GRID
  // Keep text upright despite the group rotation (counter-rotate about the label point).
  const upright = (tx: number, ty: number, el: ReactElement) => (
    <g transform={`rotate(${-rot} ${tx} ${ty})`}>{el}</g>
  )

  let inner: ReactElement
  if (c.kind === 'resistor' || c.kind === 'capacitor' || c.kind === 'inductor' || c.kind === 'vsource') {
    const x1 = ax, x2 = ax + G(2), y = ay, cx = ax + G(1)
    const label = c.kind === 'resistor' ? 'R' : c.kind === 'capacitor' ? 'C' : c.kind === 'inductor' ? 'L' : 'V'
    inner = (
      <g>
        <line x1={x1} y1={y} x2={cx - 16} y2={y} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 16} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={sw} />
        {c.kind === 'vsource'
          ? <circle cx={cx} cy={y} r={14} fill="none" stroke={stroke} strokeWidth={sw} />
          : <rect x={cx - 16} y={y - 9} width={32} height={18} rx={2} fill="var(--bg-panel)" stroke={stroke} strokeWidth={sw} />}
        {upright(cx, y - 13, <text x={cx} y={y - 13} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
        {upright(cx, y + 4, <text x={cx} y={y + 4} fill="var(--text-primary)" fontSize={10} textAnchor="middle">{label}</text>)}
      </g>
    )
  } else if (c.kind === 'opamp') {
    const xL = ax, yT = ay, yB = ay + G(2), xR = ax + G(4), yM = ay + G(1)
    inner = (
      <g>
        <line x1={xL} y1={yT} x2={xL + 10} y2={yT} stroke={stroke} strokeWidth={sw} />
        <line x1={xL} y1={yB} x2={xL + 10} y2={yB} stroke={stroke} strokeWidth={sw} />
        <line x1={xR - 6} y1={yM} x2={xR} y2={yM} stroke={stroke} strokeWidth={sw} />
        <polygon points={`${xL + 10},${yT - 8} ${xL + 10},${yB + 8} ${xR - 6},${yM}`} fill="var(--bg-panel)" stroke={stroke} strokeWidth={sw} />
        {upright(xL + 17, yT + 4, <text x={xL + 17} y={yT + 4} fill="var(--text-primary)" fontSize={11} textAnchor="middle">+</text>)}
        {upright(xL + 17, yB + 1, <text x={xL + 17} y={yB + 1} fill="var(--text-primary)" fontSize={13} textAnchor="middle">−</text>)}
        {upright(xL + 30, yM + 4, <text x={xL + 30} y={yM + 4} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
      </g>
    )
  } else if (c.kind === 'ground') {
    const x = ax, y = ay
    const col = '#cccccc' // GND = black wire; rendered light for contrast on the dark canvas
    inner = (
      <g>
        <line x1={x} y1={y} x2={x} y2={y + 10} stroke={col} strokeWidth={sw} />
        <line x1={x - 9} y1={y + 10} x2={x + 9} y2={y + 10} stroke={col} strokeWidth={sw} />
        <line x1={x - 5} y1={y + 14} x2={x + 5} y2={y + 14} stroke={col} strokeWidth={sw} />
        <line x1={x - 2} y1={y + 18} x2={x + 2} y2={y + 18} stroke={col} strokeWidth={sw} />
        {upright(x, y + 30, <text x={x} y={y + 30} fill={col} fontSize={9} textAnchor="middle">GND</text>)}
      </g>
    )
  } else if (c.kind === 'dcrail' || c.kind === 'vplus' || c.kind === 'vminus') {
    const x = ax, y = ay
    const v = c.value ?? (c.kind === 'vminus' ? -5 : 5)
    const neg = c.kind === 'vminus' || v < 0
    const col = neg ? '#4a9eff' : '#e04040' // V- blue, V+ red
    const lbl = c.kind === 'vplus' ? 'V+' : c.kind === 'vminus' ? 'V-' : (v >= 0 ? '+' : '') + v + 'V'
    inner = (
      <g>
        <line x1={x} y1={y} x2={x} y2={y - 14} stroke={col} strokeWidth={sw} />
        <line x1={x - 8} y1={y - 14} x2={x + 8} y2={y - 14} stroke={col} strokeWidth={sw} />
        {upright(x, y - 18, <text x={x} y={y - 18} fill={col} fontSize={9} textAnchor="middle">{lbl}</text>)}
      </g>
    )
  } else if (c.kind === 'awg1' || c.kind === 'awg2') {
    const x = ax, y = ay
    const lbl = c.kind === 'awg1' ? 'W1' : 'W2'
    inner = (
      <g>
        <circle cx={x} cy={y} r={11} fill="var(--bg-panel)" stroke="#e0c020" strokeWidth={sw} />
        <path d={`M ${x - 6} ${y} q 3 -6 6 0 q 3 6 6 0`} fill="none" stroke="#e0c020" strokeWidth={1.4} />
        {upright(x, y - 16, <text x={x} y={y - 16} fill="#e0c020" fontSize={10} textAnchor="middle">{lbl}</text>)}
      </g>
    )
  } else if (c.kind === 'scope1' || c.kind === 'scope2' || c.kind === 'adc1n' || c.kind === 'adc2n') {
    const x = ax, y = ay
    const ch1 = c.kind === 'scope1' || c.kind === 'adc1n'
    const col = ch1 ? 'var(--ch1-color)' : 'var(--ch2-color)'
    const lbl = c.kind === 'scope1' ? '1+' : c.kind === 'adc1n' ? '1-' : c.kind === 'scope2' ? '2+' : '2-'
    inner = (
      <g>
        <polygon points={`${x},${y - 9} ${x + 8},${y} ${x},${y + 9} ${x - 8},${y}`} fill="none" stroke={col} strokeWidth={sw} />
        {upright(x, y - 13, <text x={x} y={y - 13} fill={col} fontSize={9} textAnchor="middle">{lbl}</text>)}
      </g>
    )
  } else {
    const x = ax, y = ay
    inner = (
      <g>
        <polygon points={`${x},${y - 9} ${x + 8},${y} ${x},${y + 9} ${x - 8},${y}`} fill="none" stroke="var(--theory-color)" strokeWidth={sw} />
        {upright(x, y - 12, <text x={x} y={y - 12} fill="var(--theory-color)" fontSize={9} textAnchor="middle">OUT</text>)}
      </g>
    )
  }
  return <g transform={`rotate(${rot} ${ax} ${ay})`}>{inner}</g>
}
