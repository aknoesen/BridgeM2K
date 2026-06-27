// Schematic editor (SCH-1) — a lightweight node-and-wire editor (NOT KiCad). Place R/C/L/V/
// op-amp/ground/probe on a grid, draw wires, edit values. Produces a SPICE-2 Circuit via
// toCircuit(). See docs/specs/schematic-ngspice.md (SCH-1).
import { useMemo, useRef, useState, useEffect, type ReactElement, type Dispatch, type SetStateAction } from 'react'
import {
  Schematic, SchComponent, SchKind, terminalsOf, toCircuit, ampCategory,
  attachedWireEnds, moveComponentWithWires, moveSelectionBy, rotateComponentWithWires, type WireEndRef,
} from '../core/schematic'
import { buildNetlist } from '../core/netlist'
import { createSpiceEngine, type SpiceEngine, transferFunction } from '../core/spice'
import { UNIT, TUNE_RANGE, fmtEng, parseEng, tunePos, tuneValue } from '../core/units'
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
  { tool: 'inamp', label: 'In-amp' },
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

// UNIT, TUNE_RANGE, fmtEng, parseEng, tunePos, tuneValue now live in core/units.ts (shared
// with the Network Analyzer tune knobs). DEFAULT_VALUE stays here — it is editor-only.
const DEFAULT_VALUE: Partial<Record<SchKind, number>> = {
  resistor: 1000, capacitor: 100e-9, inductor: 1e-3, dcrail: 5, vplus: 5, vminus: -5, inamp: 10, inamp3: 10,
}

// Reference designators (R1, C2, L1, U1 for op/in-amps, V1). A new part increments from the
// highest existing number with the same prefix, so deleting one does not renumber the rest.
// The Ref field in the Selected panel lets the student override any id (must stay unique).
const REFDES: Partial<Record<SchKind, string>> = {
  resistor: 'R', capacitor: 'C', inductor: 'L', vsource: 'V',
  opamp: 'U', lmc662: 'U', inamp: 'U', inamp3: 'U',
}
function refPrefix(k: SchKind): string {
  return REFDES[k] ?? k[0].toUpperCase()
}
function newId(k: SchKind, comps: { id: string }[]): string {
  const p = refPrefix(k)
  let max = 0
  for (const c of comps) {
    const m = /^(.*?)(\d+)$/.exec(c.id)
    if (m && m[1] === p) max = Math.max(max, Number(m[2]))
  }
  return `${p}${max + 1}`
}

interface EditorProps {
  schematic: Schematic
  setSchematic: Dispatch<SetStateAction<Schematic>>
}

export default function SchematicEditor({ schematic, setSchematic }: EditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const sch = schematic
  const setSch = setSchematic
  const [tool, setTool] = useState<Tool>('resistor')
  const [selected, setSelected] = useState<string | null>(null)
  const [selSet, setSelSet] = useState<Set<string>>(new Set()) // multi-select (shift-click or box)
  const [selWires, setSelWires] = useState<Set<string>>(new Set()) // box-selected wire ends "i:1"/"i:2"
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const marqueeMoved = useRef(false)
  const [wireStart, setWireStart] = useState<{ x: number; y: number } | null>(null)
  // Single drag (one component, absolute target) OR group drag (a set + wire ends, by delta).
  const [drag, setDrag] = useState<
    | { id: string; ox: number; oy: number; attached: WireEndRef[] }
    | { ids: string[]; wireEnds: string[]; lastGx: number; lastGy: number }
    | null
  >(null)
  const [placeRotation, setPlaceRotation] = useState(0)
  // Place-time type selectors: when the Op-amp / In-amp tool is active a sub-selector below the
  // toolbar picks the exact part to drop. These map to (kind, opModel) at placement time.
  const [opampType, setOpampType] = useState<'ideal' | 'lmc662' | 'dip'>('ideal')
  const [inampType, setInampType] = useState<'inamp' | 'inamp3'>('inamp')
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

  // SCH-3: save the circuit to a .json file the student names. Uses the native Save dialog
  // (File System Access API) when the browser supports it, else falls back to a name prompt.
  async function saveCircuit() {
    // Tag the file so it self-identifies as a circuit (vs a board "lab" bundle). Old untagged
    // files (just {components,wires}) still load fine.
    const json = JSON.stringify({ kind: 'm2k-circuit', version: 1, ...sch }, null, 2)
    const sfp = (window as unknown as {
      showSavePicker?: (o: {
        suggestedName?: string
        types?: { description?: string; accept: Record<string, string[]> }[]
      }) => Promise<{ name: string; createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }>
    }).showSavePicker
    if (typeof sfp === 'function') {
      try {
        const handle = await sfp({
          suggestedName: 'm2k-circuit.json',
          types: [{ description: 'M2K circuit', accept: { 'application/json': ['.json'] } }],
        })
        const w = await handle.createWritable()
        await w.write(json)
        await w.close()
        setSimStatus('saved ' + handle.name)
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return // user cancelled the dialog
        // any other error: fall through to the download fallback below
      }
    }
    let name = prompt('Save circuit as:', 'm2k-circuit.json')
    if (name === null) return // cancelled
    name = name.trim() || 'm2k-circuit.json'
    if (!name.toLowerCase().endsWith('.json')) name += '.json'
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    setSimStatus('saved ' + name)
  }
  function openCircuit(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result))
        // Accept either a circuit file ({components,wires}) or a board "lab" bundle (the circuit
        // lives under .schematic) — so loading a lab file here still loads its circuit.
        const fromLab = d && d.schematic && Array.isArray(d.schematic.components) && Array.isArray(d.schematic.wires)
        const src = fromLab ? d.schematic : d
        if (Array.isArray(src.components) && Array.isArray(src.wires)) {
          setSch({ components: src.components, wires: src.wires })
          setSelected(null)
          setSelectedWire(null)
          setSimStatus(fromLab
            ? `loaded circuit from lab file ${f.name} — use the Board tab's Open to also restore the board`
            : `loaded ${f.name}`)
        } else {
          setSimStatus('not a valid circuit or lab file')
        }
      } catch {
        setSimStatus('could not read file')
      }
    }
    reader.readAsText(f)
    e.target.value = '' // allow re-loading the same file
  }

  // Mouse position → snapped grid coordinates.
  function gridAt(e: React.MouseEvent): { gx: number; gy: number } {
    const r = svgRef.current!.getBoundingClientRect()
    return {
      gx: Math.max(0, Math.round((e.clientX - r.left - PAD) / GRID)),
      gy: Math.max(0, Math.round((e.clientY - r.top - PAD) / GRID)),
    }
  }

  // Background mouse-down: in the Select tool, start a marquee (drag a box to select). Components
  // stop propagation on their own mouse-down, so this only fires on empty canvas.
  // Bounding box (grid units) of the current multi-selection, or null if nothing is boxed.
  function selectionBounds(): { minx: number; miny: number; maxx: number; maxy: number } | null {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, any = false
    const ext = (x: number, y: number) => { any = true; minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y) }
    for (const c of sch.components) if (selSet.has(c.id)) for (const t of terminalsOf(c)) ext(t.gx, t.gy)
    sch.wires.forEach((w, i) => { if (selWires.has(`${i}:1`)) ext(w.x1, w.y1); if (selWires.has(`${i}:2`)) ext(w.x2, w.y2) })
    return any ? { minx, miny, maxx, maxy } : null
  }

  function onSvgDown(e: React.MouseEvent) {
    if (tool !== 'select') return
    const { gx, gy } = gridAt(e)
    marqueeMoved.current = false
    // Press inside an existing selection → drag the whole group; press outside → start a new box.
    const b = selectionBounds()
    if (b && gx >= b.minx - 1 && gx <= b.maxx + 1 && gy >= b.miny - 1 && gy <= b.maxy + 1) {
      setDrag({ ids: [...selSet], wireEnds: [...selWires], lastGx: gx, lastGy: gy })
      return
    }
    setMarquee({ x0: gx, y0: gy, x1: gx, y1: gy })
  }

  function onBackgroundClick(e: React.MouseEvent) {
    if (marqueeMoved.current) { marqueeMoved.current = false; return } // a box-drag, not a click
    const { gx, gy } = gridAt(e)
    setSelectedWire(null)
    if (tool === 'select') { setSelected(null); setSelSet(new Set()); setSelWires(new Set()); return }
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
    // place a component. The Op-amp / In-amp tools resolve to a specific kind+model via the
    // place-time sub-selector; everything else places its own kind directly.
    let kind = tool as SchKind
    let opModel: SchComponent['opModel']
    if (tool === 'opamp') {
      if (opampType === 'dip') kind = 'lmc662'
      else { kind = 'opamp'; opModel = opampType === 'lmc662' ? 'lmc662' : 'ideal' }
    } else if (tool === 'inamp') {
      kind = inampType // 'inamp' (ideal) or 'inamp3' (3-op-amp)
    }
    const c: SchComponent = { id: newId(kind, sch.components), kind, gx, gy, rotation: placeRotation, value: DEFAULT_VALUE[kind], ...(opModel ? { opModel } : {}) }
    setSch((s) => ({ ...s, components: [...s.components, c] }))
    setSelected(c.id)
    setSelSet(new Set([c.id]))
    setSelWires(new Set())
  }

  function onComponentDown(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    setSelectedWire(null)
    if (e.shiftKey) {
      // Shift-click toggles membership in the multi-selection (no drag starts).
      setSelSet((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
      setSelected(id)
      return
    }
    setSelected(id) // clicking a placed part selects it in any tool (so R / Rotate act on it)
    const groupDrag = selSet.has(id) && selSet.size > 1
    if (!groupDrag) { setSelSet(new Set([id])); setSelWires(new Set()) }
    if (tool !== 'select') return
    const { gx, gy } = gridAt(e)
    if (groupDrag) {
      setDrag({ ids: [...selSet], wireEnds: [...selWires], lastGx: gx, lastGy: gy })
    } else {
      const c = sch.components.find((x) => x.id === id)!
      setDrag({ id, ox: gx - c.gx, oy: gy - c.gy, attached: attachedWireEnds(sch, c) })
    }
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
    if (marquee) {
      if (gx !== marquee.x0 || gy !== marquee.y0) marqueeMoved.current = true
      setMarquee((m) => (m ? { ...m, x1: gx, y1: gy } : m))
      return
    }
    if (!drag) return
    if ('ids' in drag) {
      // Group drag: translate the whole selection by the delta since the last grid position,
      // clamped so nothing crosses the top/left edge.
      let ddx = gx - drag.lastGx, ddy = gy - drag.lastGy
      const minGx = Math.min(...drag.ids.map((id) => sch.components.find((c) => c.id === id)?.gx ?? 0))
      const minGy = Math.min(...drag.ids.map((id) => sch.components.find((c) => c.id === id)?.gy ?? 0))
      ddx = Math.max(ddx, -minGx); ddy = Math.max(ddy, -minGy)
      if (ddx !== 0 || ddy !== 0) { marqueeMoved.current = true; setSch((s) => moveSelectionBy(s, new Set(drag.ids), new Set(drag.wireEnds), ddx, ddy)) }
      setDrag({ ids: drag.ids, wireEnds: drag.wireEnds, lastGx: drag.lastGx + ddx, lastGy: drag.lastGy + ddy })
      return
    }
    setSch((s) => moveComponentWithWires(s, drag.id, Math.max(0, gx - drag.ox), Math.max(0, gy - drag.oy), drag.attached))
  }
  function onMouseUp() {
    if (marquee) {
      if (marqueeMoved.current) {
        const xlo = Math.min(marquee.x0, marquee.x1), xhi = Math.max(marquee.x0, marquee.x1)
        const ylo = Math.min(marquee.y0, marquee.y1), yhi = Math.max(marquee.y0, marquee.y1)
        const inBox = (x: number, y: number) => x >= xlo && x <= xhi && y >= ylo && y <= yhi
        // a part is selected if ANY of its pins is in the box (forgiving for big parts like the DIP)
        const hit = sch.components.filter((c) => terminalsOf(c).some((t) => inBox(t.gx, t.gy)))
        const we = new Set<string>()
        sch.wires.forEach((w, i) => { if (inBox(w.x1, w.y1)) we.add(`${i}:1`); if (inBox(w.x2, w.y2)) we.add(`${i}:2`) })
        setSelSet(new Set(hit.map((c) => c.id)))
        setSelWires(we)
        setSelected(hit.length === 1 ? hit[0].id : null)
        setSelectedWire(null)
      }
      setMarquee(null)
    }
    setDrag(null)
  }

  function deleteSelected() {
    if (selectedWire !== null) {
      setSch((s) => ({ ...s, wires: s.wires.filter((_, i) => i !== selectedWire) }))
      setSelectedWire(null)
      return
    }
    if (selSet.size > 1) {
      const wi = new Set([...selWires].map((e) => Number(e.split(':')[0])))
      setSch((s) => ({
        components: s.components.filter((c) => !selSet.has(c.id)),
        wires: s.wires.filter((_, i) => !wi.has(i)),
      }))
      setSelSet(new Set()); setSelWires(new Set()); setSelected(null)
      return
    }
    if (!selected) return
    setSch((s) => ({ ...s, components: s.components.filter((c) => c.id !== selected) }))
    setSelSet(new Set()); setSelWires(new Set()); setSelected(null)
  }
  function rotate() {
    if (selected) {
      setSch((s) => rotateComponentWithWires(s, selected))
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

  function setSelId(text: string) {
    const name = text.trim()
    if (!name || !sel || name === sel.id) return
    if (sch.components.some((c) => c.id !== sel.id && c.id === name)) {
      setSimStatus(`Ref "${name}" is already in use`)
      return
    }
    const oldId = sel.id
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === oldId ? { ...c, id: name } : c) }))
    setSelected(name)
  }

  function setSelValue(text: string) {
    const v = parseEng(text)
    if (v === undefined || !sel) return
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, value: v } : c) }))
  }

  // LOOP-2: live numeric setter for the tune slider (no string round-trip), drives a debounced re-sim.
  function setSelValueNum(v: number) {
    if (!sel) return
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, value: v } : c) }))
  }

  // Op-amp model selector (ideal VCVS vs the LMC662 behavioural model). Switching to ideal
  // drops the V+/V- pins; any wires that were on them stay put as free segments.
  function setSelModel(m: 'ideal' | 'lmc662') {
    if (!sel) return
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, opModel: m } : c) }))
  }

  // In-amp type selector: ideal single-VCVS vs the textbook 3-op-amp topology. Same pinout,
  // so this is a clean swap of the underlying kind.
  function setSelInampType(k: 'inamp' | 'inamp3') {
    if (!sel) return
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, kind: k } : c) }))
  }

  // A pin is powered if a wire reaches it or another part's terminal sits on it.
  function pinConnected(gx: number, gy: number, selfId: string): boolean {
    if (sch.wires.some((w) => (w.x1 === gx && w.y1 === gy) || (w.x2 === gx && w.y2 === gy))) return true
    return sch.components.some((c) => c.id !== selfId && terminalsOf(c).some((t) => t.gx === gx && t.gy === gy))
  }

  // Build parts (LMC662 op-amp / DIP) need their rails wired; warn if V+/V- is floating.
  function unwiredRails(c: SchComponent): string[] {
    if (ampCategory(c) !== 'build') return []
    return terminalsOf(c)
      .filter((t) => (t.name === 'vpos' || t.name === 'vneg') && !pinConnected(t.gx, t.gy, c.id))
      .map((t) => (t.name === 'vpos' ? 'V+' : 'V−'))
  }

  const px = (g: number) => g * GRID + PAD

  // True when the cursor is over a committed multi-selection → show the "move" cursor so the
  // grab-to-move step is discoverable (matches the +/-1 grab pad in onSvgDown).
  const overSelection = (() => {
    if (tool !== 'select' || drag || marquee || !hoverGrid || (selSet.size + selWires.size) < 2) return false
    const b = selectionBounds()
    return !!b && hoverGrid.gx >= b.minx - 1 && hoverGrid.gx <= b.maxx + 1 && hoverGrid.gy >= b.miny - 1 && hoverGrid.gy <= b.maxy + 1
  })()

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Schematic Editor</span>
          <div className="display-controls">
            <button className="run-btn active" onClick={simulate} disabled={simBusy}>{simBusy ? 'Simulating…' : '▶ Simulate'}</button>
            <button className="run-btn" onClick={rotate}>Rotate (R)</button>
            <button className="run-btn" onClick={deleteSelected} disabled={!selected && selectedWire === null}>Delete</button>
            <button className="run-btn" onClick={saveCircuit}>Save</button>
            <button className="run-btn" onClick={() => fileRef.current?.click()}>Open</button>
            <button className="run-btn" onClick={() => { setSch({ components: [], wires: [] }); setSelected(null); setSelectedWire(null) }}>Clear</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={openCircuit} />
          </div>
        </div>
        <svg
          ref={svgRef}
          className="plotly-display"
          style={{ background: 'var(--bg-display)', cursor: tool !== 'select' ? 'crosshair' : (overSelection ? 'move' : 'default') }}
          onClick={onBackgroundClick}
          onMouseDown={onSvgDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { setMarquee(null); setDrag(null) }}
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
                stroke={selectedWire === i || selWires.has(`${i}:1`) || selWires.has(`${i}:2`) ? 'var(--accent-blue)' : 'var(--wire-color)'}
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
          {/* marquee box-select */}
          {marquee && (
            <rect x={px(Math.min(marquee.x0, marquee.x1))} y={px(Math.min(marquee.y0, marquee.y1))}
              width={Math.abs(marquee.x1 - marquee.x0) * GRID} height={Math.abs(marquee.y1 - marquee.y0) * GRID}
              fill="var(--accent-blue)" fillOpacity={0.12} stroke="var(--accent-blue)" strokeWidth={1}
              strokeDasharray="4 3" pointerEvents="none" />
          )}

          {/* committed multi-selection: a visible grab-box so it's clear you can press inside and
              drag to move. The +/-1 pad matches the hit area in onSvgDown. Hidden while marquee-ing. */}
          {!marquee && (selSet.size + selWires.size) >= 2 && (() => {
            const b = selectionBounds()
            if (!b) return null
            return (
              <rect x={px(b.minx - 1)} y={px(b.miny - 1)}
                width={(b.maxx - b.minx + 2) * GRID} height={(b.maxy - b.miny + 2) * GRID}
                fill="var(--accent-blue)" fillOpacity={0.06} stroke="var(--accent-blue)" strokeWidth={1}
                strokeDasharray="2 4" pointerEvents="none" />
            )
          })()}

          {/* components */}
          {sch.components.map((c) => (
            <g key={c.id} onMouseDown={(e) => onComponentDown(e, c.id)} onClick={(e) => e.stopPropagation()}
              style={{ cursor: tool === 'select' ? 'move' : 'pointer', pointerEvents: tool === 'wire' ? 'none' : 'auto' }}>
              {renderSymbol(c, px, c.id === selected || selSet.has(c.id))}
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
        {tool === 'opamp' && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3 }}>Op-amp type to place:</div>
            <div className="wave-selector">
              {([
                ['ideal', 'Ideal', 'sim'],
                ['lmc662', 'LMC662', 'build'],
                ['dip', 'LMC662 DIP', 'build'],
              ] as const).map(([v, lbl, cat]) => (
                <button key={v} className={opampType === v ? 'active' : ''} onClick={() => setOpampType(v)}
                  title={cat === 'build' ? 'Real part — needs V+/V- power' : 'Ideal model — no supply needed'}>{lbl}</button>
              ))}
            </div>
            <div style={{ fontSize: 10, marginTop: 3, color: opampType === 'ideal' ? 'var(--theory-color)' : 'var(--accent-orange)' }}>
              {opampType === 'ideal' ? 'Simulation only — no supply needed' : 'Simulation + build — wire V+/V- to power it'}
            </div>
          </div>
        )}
        {tool === 'inamp' && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 3 }}>In-amp type to place:</div>
            <div className="wave-selector">
              {([['inamp', 'Ideal'], ['inamp3', '3-op-amp']] as const).map(([v, lbl]) => (
                <button key={v} className={inampType === v ? 'active' : ''} onClick={() => setInampType(v)}>{lbl}</button>
              ))}
            </div>
            <div style={{ fontSize: 10, marginTop: 3, color: 'var(--theory-color)' }}>Simulation only — no supply needed</div>
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.6 }}>
          M2K pins — <b style={{ color: '#e0c020' }}>W1/W2</b> outputs, <b style={{ color: 'var(--ch1-color)' }}>1+/1-</b> Ch1 in,
          <b style={{ color: 'var(--ch2-color)' }}> 2+/2-</b> Ch2 in, <b style={{ color: '#e04040' }}>V+</b> /
          <b style={{ color: '#4a9eff' }}>V-</b> supply, <b style={{ color: '#cccccc' }}>GND</b>.
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
          Place angle: {placeRotation * 90}° &nbsp;(press R to rotate; rotates selected part if one is selected)
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
          Select tool: <b>drag a box</b> over parts to select them (or Shift+click), then drag any to move the group{selSet.size > 1 ? ` (${selSet.size} selected)` : ''}.
        </div>

        <div className="section-title">Selected</div>
        {sel ? (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-primary)', marginBottom: 6 }}>
              {sel.id} ({sel.kind}) — {(sel.rotation ?? 0) * 90}°
            </div>
            <button className="run-btn" style={{ marginBottom: 8 }} onClick={rotate}>Rotate this part (R)</button>
            <div className="control-row-inline">
              <label>Ref</label>
              <input type="text" defaultValue={sel.id} key={'ref-' + sel.id}
                onBlur={(e) => setSelId(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                style={{ width: 80 }} />
            </div>
            {UNIT[sel.kind] && (
              <div className="control-row-inline">
                <label>Value ({UNIT[sel.kind]})</label>
                <input type="text" defaultValue={fmtEng(sel.value ?? 0)} key={sel.id + ':' + (sel.value ?? 0)}
                  onBlur={(e) => setSelValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  style={{ width: 80 }} />
              </div>
            )}
            {TUNE_RANGE[sel.kind] && (() => {
              const [lo, hi] = TUNE_RANGE[sel.kind]!
              return (
                <div className="control-row-inline" title="Drag to tune live — the Bode/scope update as you go">
                  <label>Tune</label>
                  <input type="range" min={0} max={1000} value={tunePos(sel.value ?? lo, lo, hi)}
                    onChange={(e) => setSelValueNum(tuneValue(Number(e.target.value), lo, hi))}
                    style={{ width: 90 }} />
                </div>
              )
            })()}
            {sel.kind === 'opamp' && (
              <>
                <div className="control-row-inline">
                  <label>Type</label>
                  <select value={sel.opModel ?? 'ideal'} onChange={(e) => setSelModel(e.target.value as 'ideal' | 'lmc662')} style={{ width: 150 }}>
                    <option value="ideal">Ideal (simulation)</option>
                    <option value="lmc662">LMC662 (sim + build)</option>
                  </select>
                </div>
                {sel.opModel === 'lmc662' && (
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                    GBW 1.4 MHz, rail-to-rail out clipped at ±5 V. Bode shows the rolloff; scope shows clipping.
                  </div>
                )}
              </>
            )}
            {(sel.kind === 'inamp' || sel.kind === 'inamp3') && (
              <div className="control-row-inline">
                <label>Type</label>
                <select value={sel.kind} onChange={(e) => setSelInampType(e.target.value as 'inamp' | 'inamp3')} style={{ width: 150 }}>
                  <option value="inamp">Ideal (simulation)</option>
                  <option value="inamp3">3-op-amp (simulation)</option>
                </select>
              </div>
            )}
            {ampCategory(sel) && (() => {
              const cat = ampCategory(sel)
              const rails = unwiredRails(sel)
              return (
                <div style={{ marginTop: 4 }}>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3,
                    color: cat === 'build' ? 'var(--accent-orange)' : 'var(--theory-color)',
                    border: `1px solid ${cat === 'build' ? 'var(--accent-orange)' : 'var(--theory-color)'}`,
                  }}>
                    {cat === 'build' ? 'Simulation + build' : 'Simulation only'}
                  </span>
                  {cat === 'sim' && (
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>
                      Ideal model — no power supply needed to simulate.
                    </div>
                  )}
                  {rails.length > 0 && (
                    <div style={{ fontSize: 10, color: '#ffaa55', marginTop: 3, lineHeight: 1.4 }}>
                      ⚠ {rails.join(' and ')} not connected — a real part needs power to work.
                    </div>
                  )}
                </div>
              )
            })()}
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
  if (c.kind === 'resistor') {
    const x1 = ax, x2 = ax + G(2), y = ay, cx = ax + G(1)
    // American zigzag resistor
    const zig = `${x1},${y} ${cx - 18},${y} ${cx - 15},${y - 7} ${cx - 9},${y + 7} ${cx - 3},${y - 7} ${cx + 3},${y + 7} ${cx + 9},${y - 7} ${cx + 15},${y + 7} ${cx + 18},${y} ${x2},${y}`
    inner = (
      <g>
        <polyline points={zig} fill="none" stroke={stroke} strokeWidth={sw} />
        {upright(cx, y - 13, <text x={cx} y={y - 13} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
        {upright(cx, y + 18, <text x={cx} y={y + 18} fill="var(--text-primary)" fontSize={10} textAnchor="middle">R</text>)}
      </g>
    )
  } else if (c.kind === 'capacitor') {
    const x1 = ax, x2 = ax + G(2), y = ay, cx = ax + G(1)
    inner = (
      <g>
        <line x1={x1} y1={y} x2={cx - 4} y2={y} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 4} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={sw} />
        <line x1={cx - 4} y1={y - 11} x2={cx - 4} y2={y + 11} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 4} y1={y - 11} x2={cx + 4} y2={y + 11} stroke={stroke} strokeWidth={sw} />
        {upright(cx, y - 15, <text x={cx} y={y - 15} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
        {upright(cx, y + 20, <text x={cx} y={y + 20} fill="var(--text-primary)" fontSize={10} textAnchor="middle">C</text>)}
      </g>
    )
  } else if (c.kind === 'vsource') {
    const x1 = ax, x2 = ax + G(2), y = ay, cx = ax + G(1)
    inner = (
      <g>
        <line x1={x1} y1={y} x2={cx - 14} y2={y} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 14} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={sw} />
        <circle cx={cx} cy={y} r={14} fill="none" stroke={stroke} strokeWidth={sw} />
        {upright(cx, y - 18, <text x={cx} y={y - 18} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
        {upright(cx, y + 4, <text x={cx} y={y + 4} fill="var(--text-primary)" fontSize={11} textAnchor="middle">V</text>)}
      </g>
    )
  } else if (c.kind === 'inductor') {
    const x1 = ax, x2 = ax + G(2), y = ay, cx = ax + G(1)
    // coil = four upward semicircle humps across 36px, centered on cx
    const coil = `M ${cx - 18} ${y} a 4.5 4.5 0 0 1 9 0 a 4.5 4.5 0 0 1 9 0 a 4.5 4.5 0 0 1 9 0 a 4.5 4.5 0 0 1 9 0`
    inner = (
      <g>
        <line x1={x1} y1={y} x2={cx - 18} y2={y} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 18} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={sw} />
        <path d={coil} fill="none" stroke={stroke} strokeWidth={sw} />
        {upright(cx, y - 13, <text x={cx} y={y - 13} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
        {upright(cx, y + 18, <text x={cx} y={y + 18} fill="var(--text-primary)" fontSize={10} textAnchor="middle">L</text>)}
      </g>
    )
  } else if (c.kind === 'inamp' || c.kind === 'inamp3') {
    const xL = ax + G(1), xR = ax + G(5), yT = ay, yB = ay + G(2), yM = ay + G(1)
    const tag = c.kind === 'inamp3' ? '3-op' : 'INA'
    inner = (
      <g>
        <line x1={ax} y1={yT} x2={xL} y2={yT} stroke={stroke} strokeWidth={sw} />
        <line x1={ax} y1={yB} x2={xL} y2={yB} stroke={stroke} strokeWidth={sw} />
        <line x1={xR} y1={yM} x2={ax + G(6)} y2={yM} stroke={stroke} strokeWidth={sw} />
        <line x1={ax + G(2)} y1={yB + 2} x2={ax + G(2)} y2={ay + G(3)} stroke={stroke} strokeWidth={sw} />
        <polygon points={`${xL},${yT - 12} ${xL},${yB + 12} ${xR},${yM}`} fill="var(--bg-panel)" stroke={stroke} strokeWidth={sw} />
        {upright(xL + 12, yT + 4, <text x={xL + 12} y={yT + 4} fill="var(--text-primary)" fontSize={11} textAnchor="middle">+</text>)}
        {upright(xL + 12, yB + 1, <text x={xL + 12} y={yB + 1} fill="var(--text-primary)" fontSize={13} textAnchor="middle">−</text>)}
        {upright(ax + G(2.6), yM + 4, <text x={ax + G(2.6)} y={yM + 4} fill="var(--text-secondary)" fontSize={9} textAnchor="middle">{tag}</text>)}
        {upright(ax + G(2), ay + G(3) + 10, <text x={ax + G(2)} y={ay + G(3) + 10} fill="var(--text-secondary)" fontSize={8} textAnchor="middle">REF</text>)}
        {upright(ax + G(2.6), yT - 14, <text x={ax + G(2.6)} y={yT - 14} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
      </g>
    )
  } else if (c.kind === 'opamp') {
    const xL = ax, yT = ay, yB = ay + G(2), xR = ax + G(4), yM = ay + G(1)
    const xMid = ax + G(2)
    inner = (
      <g>
        <line x1={xL} y1={yT} x2={xL + 10} y2={yT} stroke={stroke} strokeWidth={sw} />
        <line x1={xL} y1={yB} x2={xL + 10} y2={yB} stroke={stroke} strokeWidth={sw} />
        <line x1={xR - 6} y1={yM} x2={xR} y2={yM} stroke={stroke} strokeWidth={sw} />
        <polygon points={`${xL + 10},${yT - 8} ${xL + 10},${yB + 8} ${xR - 6},${yM}`} fill="var(--bg-panel)" stroke={stroke} strokeWidth={sw} />
        {/* V+ / V- power stubs (top/bottom) — only the LMC662 (sim+build) model has rails */}
        {c.opModel === 'lmc662' && (
          <>
            <line x1={xMid} y1={ay - G(1)} x2={xMid} y2={ay + 2} stroke="#e04040" strokeWidth={sw} />
            <line x1={xMid} y1={ay + G(3)} x2={xMid} y2={ay + G(2) - 2} stroke="#4a9eff" strokeWidth={sw} />
            {upright(xMid + 9, ay - G(1) + 4, <text x={xMid + 9} y={ay - G(1) + 4} fill="#e04040" fontSize={9} textAnchor="middle">V+</text>)}
            {upright(xMid + 9, ay + G(3), <text x={xMid + 9} y={ay + G(3)} fill="#4a9eff" fontSize={9} textAnchor="middle">V−</text>)}
          </>
        )}
        {upright(xL + 17, yT + 4, <text x={xL + 17} y={yT + 4} fill="var(--text-primary)" fontSize={11} textAnchor="middle">+</text>)}
        {upright(xL + 17, yB + 1, <text x={xL + 17} y={yB + 1} fill="var(--text-primary)" fontSize={13} textAnchor="middle">−</text>)}
        {upright(xL + 30, yM + 4, <text x={xL + 30} y={yM + 4} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
      </g>
    )
  } else if (c.kind === 'lmc662') {
    // 8-pin DIP. Left pins 1-4 (OUTA,-A,+A,V-), right pins top→bottom (V+,OUTB,-B,+B).
    const w = G(4)
    const bx0 = ax + 12, bx1 = ax + w - 12, by0 = ay - 10, by1 = ay + G(3) + 10
    const cxm = (bx0 + bx1) / 2
    const lLab = ['OUTA', '−A', '+A', 'V−']
    const rLab = ['V+', 'OUTB', '−B', '+B']
    inner = (
      <g>
        <rect x={bx0} y={by0} width={bx1 - bx0} height={by1 - by0} rx={4} fill="var(--bg-panel)" stroke={stroke} strokeWidth={sw} />
        <path d={`M ${cxm - 7},${by0} a 7 7 0 0 0 14 0`} fill="none" stroke={stroke} strokeWidth={sw} />
        {[0, 1, 2, 3].map((i) => (
          <g key={'l' + i}>
            <line x1={ax} y1={ay + G(i)} x2={bx0} y2={ay + G(i)} stroke={stroke} strokeWidth={sw} />
            {upright(bx0 + 13, ay + G(i) + 3, <text x={bx0 + 13} y={ay + G(i) + 3} fill="var(--text-secondary)" fontSize={8} textAnchor="start">{lLab[i]}</text>)}
          </g>
        ))}
        {[0, 1, 2, 3].map((i) => (
          <g key={'r' + i}>
            <line x1={ax + w} y1={ay + G(i)} x2={bx1} y2={ay + G(i)} stroke={stroke} strokeWidth={sw} />
            {upright(bx1 - 13, ay + G(i) + 3, <text x={bx1 - 13} y={ay + G(i) + 3} fill="var(--text-secondary)" fontSize={8} textAnchor="end">{rLab[i]}</text>)}
          </g>
        ))}
        {upright(cxm, ay + G(1) + 2, <text x={cxm} y={ay + G(1) + 2} fill="var(--ch1-color)" fontSize={9} textAnchor="middle">{c.id}</text>)}
        {upright(cxm, ay + G(2) + 2, <text x={cxm} y={ay + G(2) + 2} fill="var(--text-secondary)" fontSize={8} textAnchor="middle">LMC662</text>)}
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
