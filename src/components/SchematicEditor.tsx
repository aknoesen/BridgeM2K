// Schematic editor (SCH-1) — a lightweight node-and-wire editor (NOT KiCad). Place R/C/L/V/
// op-amp/ground/probe on a grid, draw wires, edit values. Produces a SPICE-2 Circuit via
// toCircuit(). See docs/specs/schematic-ngspice.md (SCH-1).
import { useMemo, useRef, useState, useEffect, type ReactElement, type Dispatch, type SetStateAction } from 'react'
import {
  Schematic, SchComponent, SchKind, terminalsOf, toCircuit, ampCategory, computeNets,
  attachedWireEnds, moveComponentWithWires, moveSelectionBy, rotateComponentWithWires, type WireEndRef,
} from '../core/schematic'
import { buildNetlist, TRANSISTOR_PARTS } from '../core/netlist'
import { EXAMPLES } from '../core/examples'
import { createSpiceEngine, type SpiceEngine, transferFunction } from '../core/spice'
import { UNIT, TUNE_RANGE, fmtEng, parseEng, tunePos, tuneValue } from '../core/units'
import { kitValues, isKitValue, nearestKitValue, formatValue, type PassiveKind } from '../core/kit'
import { opampList, getOpamp, isKitOpamp } from '../core/opamps'
import { exportSvgToPng } from './exportImage'
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
  { tool: 'diode', label: 'Diode' },
  { tool: 'led', label: 'LED' },
  { tool: 'zener', label: 'Zener' },
  { tool: 'photodiode', label: 'Photo' },
  { tool: 'bjt', label: 'BJT' },
  { tool: 'mosfet', label: 'MOSFET' },
  { tool: 'opamp', label: 'Op-amp' },
  { tool: 'ina125', label: 'INA125' },
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
// SCH-10: passive kinds whose value is picked from the ADALP2000 kit catalog (PassiveKind names
// match these SchKinds). No 'potentiometer' SchKind exists yet, so the picker covers R/C/L only.
const KIT_PASSIVE = new Set<SchKind>(['resistor', 'capacitor', 'inductor'])

const DEFAULT_VALUE: Partial<Record<SchKind, number>> = {
  resistor: 1000, capacitor: 100e-9, inductor: 1e-3, dcrail: 5, vplus: 5, vminus: -5,
  led: 2.0, zener: 3.3, photodiode: 80e-6,
}

// Default ADALP2000 part placed for a new transistor / op-amp (overridable in the Selected panel).
// op-amp defaults to a kit rail-to-rail part so new placements are kit; legacy circuits with no
// part fall back to the LMC662 model and show the off-kit warning.
const DEFAULT_PART: Partial<Record<SchKind, string>> = {
  bjt: '2N3904', mosfet: 'ZVN2110A', opamp: 'op484',
}

// Reference designators (R1, C2, L1, U1 for op/in-amps, V1). A new part increments from the
// highest existing number with the same prefix, so deleting one does not renumber the rest.
// The Ref field in the Selected panel lets the student override any id (must stay unique).
const REFDES: Partial<Record<SchKind, string>> = {
  resistor: 'R', capacitor: 'C', inductor: 'L', vsource: 'V',
  opamp: 'U', lmc662: 'U', ina125: 'U', bjt: 'Q', mosfet: 'M',
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
  // Shared schematic undo/redo, owned by App so the Board tab's lab load uses the same history.
  snapshot: () => void
  undo: () => void
  redo: () => void
  // Apply an example's preset generator (W1) on load (e.g. a triangle sweep for an I-V curve).
  onLoadGenerators?: (w1?: import('../core/signal').SignalParams, w2?: import('../core/signal').SignalParams) => void
  // Request the scope setup an example wants on load (XY mode + optional Volts/div framing).
  onLoadScope?: (req: { xy: boolean; ch1Vdiv?: number; ch2Vdiv?: number }) => void
  // Open the Curve Tracer when an example requests it (SWEEP-1 curve-family examples).
  onOpenTracer?: () => void
}

export default function SchematicEditor({ schematic, setSchematic, snapshot, undo, redo, onLoadGenerators, onLoadScope, onOpenTracer }: EditorProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const sch = schematic
  const setSch = setSchematic
  const [tool, setTool] = useState<Tool>('select')
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
  const [simStatus, setSimStatus] = useState('')
  const [simBusy, setSimBusy] = useState(false)
  const engineRef = useRef<SpiceEngine | null>(null)
  const [hoverGrid, setHoverGrid] = useState<{ gx: number; gy: number } | null>(null)
  const [selectedWire, setSelectedWire] = useState<number | null>(null)

  // ---- Clipboard (copy/paste/cut). Undo/redo (snapshot/undo/redo) come from App via props. -----
  const dragSnapped = useRef(false) // snapshot once per drag/tune gesture, not per mouse-move
  const clip = useRef<{ components: Schematic['components']; wires: Schematic['wires'] } | null>(null)

  // Copy the current selection (parts + any wires whose both ends sit on selected parts' pins).
  function copySelection(): boolean {
    const ids = selSet.size ? [...selSet] : (selected ? [selected] : [])
    if (!ids.length) return false
    const comps = sch.components.filter((c) => ids.includes(c.id))
    const term = new Set<string>()
    for (const c of comps) for (const t of terminalsOf(c)) term.add(`${t.gx},${t.gy}`)
    const wires = sch.wires.filter((w) => term.has(`${w.x1},${w.y1}`) && term.has(`${w.x2},${w.y2}`))
    clip.current = { components: comps.map((c) => ({ ...c })), wires: wires.map((w) => ({ ...w })) }
    return true
  }
  function pasteClipboard() {
    if (!clip.current || !clip.current.components.length) return
    snapshot()
    const dx = 2, dy = 2 // offset the copy so it doesn't sit on the original
    const existing = [...sch.components]
    const newComps = clip.current.components.map((c) => {
      const nc = { ...c, id: newId(c.kind, existing), gx: c.gx + dx, gy: c.gy + dy }
      existing.push(nc)
      return nc
    })
    const newWires = clip.current.wires.map((w) => ({ x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy }))
    setSch((s) => ({ components: [...s.components, ...newComps], wires: [...s.wires, ...newWires] }))
    setSelSet(new Set(newComps.map((c) => c.id)))
    setSelected(newComps.length === 1 ? newComps[0].id : null)
    setSelWires(new Set()); setSelectedWire(null)
  }
  function cutSelection() {
    if (copySelection()) deleteSelected()
  }

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
      showSaveFilePicker?: (o: {
        suggestedName?: string
        types?: { description?: string; accept: Record<string, string[]> }[]
      }) => Promise<{ name: string; createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }>
    }).showSaveFilePicker
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
          snapshot()
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
    dragSnapped.current = false
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
          snapshot()
          setSch((s) => ({ ...s, wires: [...s.wires, { x1: wireStart.x, y1: wireStart.y, x2: gx, y2: gy }] }))
        }
        setWireStart(null)
      }
      return
    }
    // place a component. The Op-amp / In-amp tools resolve to a specific kind+model via the
    // place-time sub-selector; everything else places its own kind directly.
    const kind = tool as SchKind
    // Op-amp places kind 'opamp' (LMC662); INA125 places kind 'ina125'. Power implied in sim, DIP on board.
    const c: SchComponent = { id: newId(kind, sch.components), kind, gx, gy, rotation: placeRotation, value: DEFAULT_VALUE[kind], part: DEFAULT_PART[kind] }
    snapshot()
    setSch((s) => ({ ...s, components: [...s.components, c] }))
    setSelected(c.id)
    setSelSet(new Set([c.id]))
    setSelWires(new Set())
  }

  function onComponentDown(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    setSelectedWire(null)
    dragSnapped.current = false
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
      if (ddx !== 0 || ddy !== 0) { if (!dragSnapped.current) { snapshot(); dragSnapped.current = true } marqueeMoved.current = true; setSch((s) => moveSelectionBy(s, new Set(drag.ids), new Set(drag.wireEnds), ddx, ddy)) }
      setDrag({ ids: drag.ids, wireEnds: drag.wireEnds, lastGx: drag.lastGx + ddx, lastGy: drag.lastGy + ddy })
      return
    }
    if (!dragSnapped.current) { snapshot(); dragSnapped.current = true }
    setSch((s) => moveComponentWithWires(s, drag.id, Math.max(0, gx - drag.ox), Math.max(0, gy - drag.oy), drag.attached))
  }
  function onMouseUp() {
    dragSnapped.current = false
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
    if (selectedWire === null && selSet.size === 0 && !selected) return
    snapshot()
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
      snapshot()
      setSch((s) => rotateComponentWithWires(s, selected))
    } else {
      setPlaceRotation((r) => (r + 1) % 4)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return // let text fields keep their own keys
      const mod = e.ctrlKey || e.metaKey
      if (mod) {
        const k = e.key.toLowerCase()
        const clearSel = () => { setSelected(null); setSelectedWire(null); setSelSet(new Set()); setSelWires(new Set()) }
        if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); clearSel() }
        else if (k === 'y') { e.preventDefault(); redo(); clearSel() }
        else if (k === 'c') { e.preventDefault(); copySelection() }
        else if (k === 'v') { e.preventDefault(); pasteClipboard() }
        else if (k === 'x') { e.preventDefault(); cutSelection() }
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selected || selectedWire !== null || selSet.size)) deleteSelected()
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
    snapshot()
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === oldId ? { ...c, id: name } : c) }))
    setSelected(name)
  }

  function setSelValue(text: string) {
    const v = parseEng(text)
    if (v === undefined || !sel) return
    snapshot()
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, value: v } : c) }))
  }

  // LOOP-2: live numeric setter for the tune slider (no string round-trip), drives a debounced re-sim.
  function setSelValueNum(v: number) {
    if (!sel) return
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, value: v } : c) }))
  }

  // Convert a placed diode between plain / LED / Zener / Photodiode; reset value to the new type's
  // sensible default (LED Vf 2 V, Zener BV 3.3 V, Photodiode 80 µA; plain diode has no value).
  function setSelDiodeKind(k: 'diode' | 'led' | 'zener' | 'photodiode') {
    if (!sel) return
    snapshot()
    const value = k === 'led' ? 2.0 : k === 'zener' ? 3.3 : k === 'photodiode' ? 80e-6 : undefined
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, kind: k, value } : c) }))
  }

  // SCH-8: choose the ADALP2000 transistor part (sets the NPN/PNP or N/P-channel model body).
  function setSelPart(part: string) {
    if (!sel) return
    snapshot()
    setSch((s) => ({ ...s, components: s.components.map((c) => c.id === sel.id ? { ...c, part } : c) }))
  }

  // SCH-9: estimate an op-amp's closed-loop noise gain (1 + Rf/Rg) from the resistors on its inN
  // node, so the inspector can fire the OP37 "min stable gain 5" warning. Returns null if the
  // topology isn't a recognisable resistive-feedback amp. A direct out→inN short (unity buffer) → 1;
  // feedback with no gain-setting leg (e.g. transimpedance) → Infinity (treated as ≥ stable).
  function opampNoiseGain(op: SchComponent): number | null {
    const nets = computeNets(sch)
    const ts = terminalsOf(op)
    const inN = ts.find((t) => t.name === 'inN'); const out = ts.find((t) => t.name === 'out')
    if (!inN || !out) return null
    const inNnet = nets.get(`${inN.gx},${inN.gy}`); const outnet = nets.get(`${out.gx},${out.gy}`)
    if (!inNnet || !outnet) return null
    if (inNnet === outnet) return 1 // out tied straight back to inN → unity-gain follower
    let rf: number | null = null; let rg: number | null = null
    for (const c of sch.components) {
      if (c.kind !== 'resistor') continue
      const rt = terminalsOf(c)
      const a = nets.get(`${rt[0].gx},${rt[0].gy}`); const b = nets.get(`${rt[1].gx},${rt[1].gy}`)
      if (a !== inNnet && b !== inNnet) continue
      const other = a === inNnet ? b : a
      const ohms = c.value ?? 0
      if (other === outnet) rf = ohms                          // feedback resistor
      else if (rg === null || ohms < rg) rg = ohms             // smallest gain-setting leg
    }
    if (rf === null) return null              // no resistive feedback recognised
    if (rg === null) return Infinity          // feedback only (transimpedance) → high noise gain
    return rg > 0 ? 1 + rf / rg : Infinity
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
            <button className="run-btn" title="Save the schematic as a PNG (transparent background) for your prelab"
              onClick={() => { if (svgRef.current) exportSvgToPng(svgRef.current, 'schematic.png', { light: true }).catch((e) => setSimStatus('Export failed: ' + e.message)) }}>
              Export PNG
            </button>
            <select className="run-btn" title="Load an example circuit" value=""
              onChange={(e) => {
                const ex = EXAMPLES.find((x) => x.id === e.target.value)
                if (ex) {
                  snapshot()
                  setSch(JSON.parse(JSON.stringify(ex.schematic)))
                  setSelected(null); setSelectedWire(null)
                  // Drop to the Select tool so the first click on the canvas doesn't drop a resistor.
                  setTool('select'); setWireStart(null)
                  if (ex.w1 || ex.w2) onLoadGenerators?.(ex.w1, ex.w2)
                  onLoadScope?.({ xy: !!ex.xy, ch1Vdiv: ex.ch1Vdiv, ch2Vdiv: ex.ch2Vdiv })
                  if (ex.tracer) onOpenTracer?.()
                  setSimStatus('loaded example: ' + ex.name)
                }
              }}>
              <option value="">Examples ▾</option>
              {['Passive', 'Amplifiers'].map((g) => (
                <optgroup key={g} label={g}>
                  {EXAMPLES.filter((x) => x.group === g).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className="run-btn" onClick={() => { snapshot(); setSch({ components: [], wires: [] }); setSelected(null); setSelectedWire(null) }}>Clear</button>
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

          {/* junction dots — a filled dot where two pins butt together (a touch-connection) or three
              or more pins/wires meet, so "these are electrically connected here" is always visible. */}
          {(() => {
            const cnt = new Map<string, { t: number; w: number; x: number; y: number }>()
            const bump = (x: number, y: number, k: 't' | 'w') => {
              const e = cnt.get(`${x},${y}`) ?? { t: 0, w: 0, x, y }
              e[k]++; cnt.set(`${x},${y}`, e)
            }
            for (const c of sch.components) for (const t of terminalsOf(c)) bump(t.gx, t.gy, 't')
            for (const w of sch.wires) { bump(w.x1, w.y1, 'w'); bump(w.x2, w.y2, 'w') }
            const dots: ReactElement[] = []
            for (const e of cnt.values()) {
              if (e.t >= 2 || e.t + e.w >= 3) {
                dots.push(<circle key={`j${e.x},${e.y}`} cx={px(e.x)} cy={px(e.y)} r={4} fill="var(--wire-color)" pointerEvents="none" />)
              }
            }
            return dots
          })()}
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
          <div style={{ fontSize: 10, marginTop: 6, color: 'var(--text-secondary)' }}>
            Op-amp — defaults to a kit part (OP484); pick the exact ADALP2000 op-amp in the Selected panel. Power implied in simulation; a DIP on the breadboard.
          </div>
        )}
        {tool === 'ina125' && (
          <div style={{ fontSize: 10, marginTop: 6, color: 'var(--text-secondary)' }}>
            INA125 instrumentation amp. Gain = 4 + 60 kΩ/R_G — set it with an external resistor across the
            RG pins. Power implied in sim; on the breadboard it's a 16-pin DIP whose V+/V− you wire.
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
            {(sel.kind === 'diode' || sel.kind === 'led' || sel.kind === 'zener' || sel.kind === 'photodiode') && (
              <div className="control-row-inline">
                <label>Type</label>
                <select value={sel.kind} onChange={(e) => setSelDiodeKind(e.target.value as 'diode' | 'led' | 'zener' | 'photodiode')} style={{ width: 150 }}>
                  <option value="diode">Diode (silicon)</option>
                  <option value="led">LED (set Vf)</option>
                  <option value="zener">Zener (set BV)</option>
                  <option value="photodiode">Photodiode (set Iₚ)</option>
                </select>
              </div>
            )}
            {(sel.kind === 'bjt' || sel.kind === 'mosfet') && (
              <div className="control-row-inline">
                <label>Part</label>
                <select value={sel.part ?? ''} onChange={(e) => setSelPart(e.target.value)} style={{ width: 150 }}>
                  {Object.entries(TRANSISTOR_PARTS)
                    .filter(([, p]) => sel.kind === 'bjt' ? (p.type === 'npn' || p.type === 'pnp') : (p.type === 'nmos' || p.type === 'pmos'))
                    .map(([name, p]) => <option key={name} value={name}>{name} ({p.type.toUpperCase()})</option>)}
                </select>
              </div>
            )}
            {KIT_PASSIVE.has(sel.kind) ? (() => {
              // SCH-10 kit picker: a value can only be one the student physically has. A loaded
              // off-kit value (legacy file / live-tuned) is NOT mutated — it shows flagged with a
              // one-click snap to the nearest kit value.
              const pk = sel.kind as PassiveKind
              const v = sel.value ?? 0
              const onKit = isKitValue(pk, v)
              const near = nearestKitValue(pk, v)
              return (
                <>
                  <div className="control-row-inline" title="Pick a value from your ADALP2000 parts kit">
                    <label>Value</label>
                    <select value={onKit ? String(near.value) : '__off'}
                      onChange={(e) => { if (e.target.value !== '__off') { snapshot(); setSelValueNum(Number(e.target.value)) } }}
                      style={{ width: 150 }}>
                      {!onKit && <option value="__off">{formatValue(pk, v)} — not in kit</option>}
                      {kitValues(pk).map((p) => (
                        <option key={p.value} value={String(p.value)}>{p.label}{p.partNumber ? ` (${p.partNumber})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  {!onKit && (
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, color: '#ffaa55', border: '1px solid #ffaa55' }}>
                        ⚠ not in your parts kit
                      </span>
                      <button className="run-btn" title={`Snap to the nearest kit value (${near.label})`}
                        onClick={() => { snapshot(); setSelValueNum(near.value) }}>
                        Snap to {near.label}
                      </button>
                    </div>
                  )}
                </>
              )
            })() : UNIT[sel.kind] ? (
              <div className="control-row-inline">
                <label>Value ({UNIT[sel.kind]})</label>
                <input type="text" defaultValue={fmtEng(sel.value ?? 0)} key={sel.id + ':' + (sel.value ?? 0)}
                  onBlur={(e) => setSelValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  style={{ width: 80 }} />
              </div>
            ) : null}
            {TUNE_RANGE[sel.kind] && (() => {
              const [lo, hi] = TUNE_RANGE[sel.kind]!
              return (
                <div className="control-row-inline" title="Drag to tune live — the Bode/scope update as you go">
                  <label>Tune</label>
                  <input type="range" min={0} max={1000} value={tunePos(sel.value ?? lo, lo, hi)}
                    onPointerDown={() => snapshot()}
                    onChange={(e) => setSelValueNum(tuneValue(Number(e.target.value), lo, hi))}
                    style={{ width: 90 }} />
                </div>
              )
            })()}
            {sel.kind === 'opamp' && (() => {
              // SCH-9 kit op-amp picker. No kit `part` → legacy LMC662 model (off-kit) with a swap.
              const kind = sel.part && isKitOpamp(sel.part) ? sel.part : null
              const onKit = kind !== null
              const part = kind ? getOpamp(kind) : null
              const gain = opampNoiseGain(sel)
              const op37LowGain = part?.kind === 'op37' && gain !== null && gain < 5
              const overSupply = part ? 10 > part.supplyMax : false // M2K rails are ±5 (10 V total)
              return (
                <>
                  <div className="control-row-inline" title="Pick an op-amp from your ADALP2000 parts kit">
                    <label>Op-amp</label>
                    <select value={kind ?? '__off'}
                      onChange={(e) => { if (e.target.value !== '__off') setSelPart(e.target.value) }}
                      style={{ width: 150 }}>
                      {!onKit && <option value="__off">LMC662 — not in kit</option>}
                      {opampList().map((p) => (
                        <option key={p.kind} value={p.kind}>{p.name} ({p.package})</option>
                      ))}
                    </select>
                  </div>
                  {part && (
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                      {part.name}: GBW {fmtEng(part.gbwHz)}Hz, slew {part.slewRate} V/µs,
                      {part.railToRailOut ? ' rail-to-rail output' : ` output to ~${part.outputHeadroom} V of each rail`}.
                    </div>
                  )}
                  {!onKit && (
                    <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, color: '#ffaa55', border: '1px solid #ffaa55' }}>
                        ⚠ not in your parts kit
                      </span>
                      <button className="run-btn" title="Swap to the kit OP484 (rail-to-rail, ±5 V)"
                        onClick={() => setSelPart('op484')}>Swap to OP484</button>
                    </div>
                  )}
                  {op37LowGain && (
                    <div style={{ fontSize: 10, color: '#ffaa55', marginTop: 4, lineHeight: 1.4 }}>
                      ⚠ OP37 is decompensated — stable only at closed-loop gain ≥ 5 (this stage ≈ {gain === Infinity ? '∞' : gain.toFixed(1)}). Use OP27 for low gain.
                    </div>
                  )}
                  {overSupply && (
                    <div style={{ fontSize: 10, color: '#ffaa55', marginTop: 4, lineHeight: 1.4 }}>
                      ⚠ {part!.name} is single-supply {part!.supplyMin}–{part!.supplyMax} V — the M2K's ±5 V rails (10 V) exceed its max.
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                    Power is implied in simulation (auto ±5 V); on the breadboard it's a DIP whose V+/V− you wire to the rails.
                  </div>
                </>
              )
            })()}
            {sel.kind === 'ina125' && (
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
                INA125 in-amp. Gain = 4 + 60 kΩ/R_G (external R_G across the RG pins). Output referred to
                IAREF (tie to GND). 16-pin DIP on the board; wire V+/V− to the rails.
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
        {upright(cx, y + 18, <text x={cx} y={y + 18} fill="var(--text-primary)" fontSize={9} textAnchor="middle">{fmtEng(c.value ?? 0)}{UNIT[c.kind] ?? ''}</text>)}
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
        {upright(cx, y + 20, <text x={cx} y={y + 20} fill="var(--text-primary)" fontSize={9} textAnchor="middle">{fmtEng(c.value ?? 0)}{UNIT[c.kind] ?? ''}</text>)}
      </g>
    )
  } else if (c.kind === 'diode') {
    const x1 = ax, x2 = ax + G(2), y = ay, cx = ax + G(1)
    inner = (
      <g>
        <line x1={x1} y1={y} x2={cx - 7} y2={y} stroke={stroke} strokeWidth={sw} />
        {/* anode triangle pointing to the cathode bar */}
        <polygon points={`${cx - 7},${y - 9} ${cx - 7},${y + 9} ${cx + 5},${y}`} fill={stroke} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        <line x1={cx + 5} y1={y - 9} x2={cx + 5} y2={y + 9} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 5} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={sw} />
        {upright(cx, y - 15, <text x={cx} y={y - 15} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
      </g>
    )
  } else if (c.kind === 'led') {
    const x1 = ax, x2 = ax + G(2), y = ay, cx = ax + G(1)
    inner = (
      <g>
        <line x1={x1} y1={y} x2={cx - 7} y2={y} stroke={stroke} strokeWidth={sw} />
        <polygon points={`${cx - 7},${y - 9} ${cx - 7},${y + 9} ${cx + 5},${y}`} fill={stroke} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        <line x1={cx + 5} y1={y - 9} x2={cx + 5} y2={y + 9} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 5} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={sw} />
        {/* two emission arrows (light coming out) */}
        <line x1={cx - 1} y1={y - 11} x2={cx + 6} y2={y - 19} stroke={stroke} strokeWidth={1.3} />
        <line x1={cx + 6} y1={y - 19} x2={cx + 2.5} y2={y - 17.5} stroke={stroke} strokeWidth={1.3} />
        <line x1={cx + 6} y1={y - 19} x2={cx + 5} y2={y - 15.5} stroke={stroke} strokeWidth={1.3} />
        <line x1={cx + 5} y1={y - 10} x2={cx + 12} y2={y - 18} stroke={stroke} strokeWidth={1.3} />
        <line x1={cx + 12} y1={y - 18} x2={cx + 8.5} y2={y - 16.5} stroke={stroke} strokeWidth={1.3} />
        <line x1={cx + 12} y1={y - 18} x2={cx + 11} y2={y - 14.5} stroke={stroke} strokeWidth={1.3} />
        {upright(cx, y + 18, <text x={cx} y={y + 18} fill="var(--text-secondary)" fontSize={9} textAnchor="middle">{c.id}</text>)}
      </g>
    )
  } else if (c.kind === 'zener') {
    const x1 = ax, x2 = ax + G(2), y = ay, cx = ax + G(1)
    inner = (
      <g>
        <line x1={x1} y1={y} x2={cx - 7} y2={y} stroke={stroke} strokeWidth={sw} />
        <polygon points={`${cx - 7},${y - 9} ${cx - 7},${y + 9} ${cx + 5},${y}`} fill={stroke} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        {/* Zener cathode bar with bent ends (the "Z" flag) */}
        <line x1={cx + 5} y1={y - 9} x2={cx + 5} y2={y + 9} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 5} y1={y - 9} x2={cx + 1} y2={y - 9} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 5} y1={y + 9} x2={cx + 9} y2={y + 9} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 5} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={sw} />
        {upright(cx, y - 15, <text x={cx} y={y - 15} fill="var(--text-secondary)" fontSize={9} textAnchor="middle">{c.id}</text>)}
      </g>
    )
  } else if (c.kind === 'photodiode') {
    const x1 = ax, x2 = ax + G(2), y = ay, cx = ax + G(1)
    inner = (
      <g>
        <line x1={x1} y1={y} x2={cx - 7} y2={y} stroke={stroke} strokeWidth={sw} />
        <polygon points={`${cx - 7},${y - 9} ${cx - 7},${y + 9} ${cx + 5},${y}`} fill={stroke} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        <line x1={cx + 5} y1={y - 9} x2={cx + 5} y2={y + 9} stroke={stroke} strokeWidth={sw} />
        <line x1={cx + 5} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={sw} />
        {/* two arrows pointing IN (incoming light) — the photodiode convention, opposite the LED */}
        <line x1={cx + 6} y1={y - 19} x2={cx - 1} y2={y - 11} stroke={stroke} strokeWidth={1.3} />
        <line x1={cx - 1} y1={y - 11} x2={cx + 2.5} y2={y - 10} stroke={stroke} strokeWidth={1.3} />
        <line x1={cx - 1} y1={y - 11} x2={cx} y2={y - 14.5} stroke={stroke} strokeWidth={1.3} />
        <line x1={cx + 12} y1={y - 18} x2={cx + 5} y2={y - 10} stroke={stroke} strokeWidth={1.3} />
        <line x1={cx + 5} y1={y - 10} x2={cx + 8.5} y2={y - 9} stroke={stroke} strokeWidth={1.3} />
        <line x1={cx + 5} y1={y - 10} x2={cx + 6} y2={y - 13.5} stroke={stroke} strokeWidth={1.3} />
        {upright(cx, y + 18, <text x={cx} y={y + 18} fill="var(--text-secondary)" fontSize={9} textAnchor="middle">{c.id}</text>)}
      </g>
    )
  } else if (c.kind === 'bjt') {
    // terminals: collector (2,0) top-right, base (0,1) left, emitter (2,2) bottom-right.
    const npn = (c.part ? TRANSISTOR_PARTS[c.part]?.type : 'npn') !== 'pnp'
    const bx = ax + 18 // base bar x
    inner = (
      <g>
        <line x1={ax} y1={ay + G(1)} x2={bx} y2={ay + G(1)} stroke={stroke} strokeWidth={sw} />
        <line x1={bx} y1={ay + 12} x2={bx} y2={ay + 36} stroke={stroke} strokeWidth={sw} />
        <line x1={bx} y1={ay + 18} x2={ax + G(2)} y2={ay} stroke={stroke} strokeWidth={sw} />
        <line x1={bx} y1={ay + 30} x2={ax + G(2)} y2={ay + G(2)} stroke={stroke} strokeWidth={sw} />
        {/* emitter arrow: NPN points out toward the emitter; PNP points in toward the base */}
        <polygon points={npn
          ? `${ax + 42},${ay + 44} ${ax + 34},${ay + 45} ${ax + 39},${ay + 37}`
          : `${ax + 28},${ay + 36} ${ax + 32},${ay + 43} ${ax + 36},${ay + 36}`}
          fill={stroke} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
        {upright(ax + G(1), ay - 5, <text x={ax + G(1)} y={ay - 5} fill="var(--text-secondary)" fontSize={9} textAnchor="middle">{c.id}</text>)}
        {upright(ax + G(1), ay + G(2) + 13, <text x={ax + G(1)} y={ay + G(2) + 13} fill="var(--text-primary)" fontSize={8} textAnchor="middle">{c.part ?? 'BJT'}</text>)}
      </g>
    )
  } else if (c.kind === 'mosfet') {
    // terminals: drain (2,0) top-right, gate (0,1) left, source (2,2) bottom-right.
    const nch = (c.part ? TRANSISTOR_PARTS[c.part]?.type : 'nmos') !== 'pmos'
    const gp = ax + 12 // gate plate x
    const chx = ax + 18 // channel x
    inner = (
      <g>
        <line x1={ax} y1={ay + G(1)} x2={gp} y2={ay + G(1)} stroke={stroke} strokeWidth={sw} />
        <line x1={gp} y1={ay + 11} x2={gp} y2={ay + 37} stroke={stroke} strokeWidth={sw} />
        {/* enhancement channel: three broken bars */}
        <line x1={chx} y1={ay + 11} x2={chx} y2={ay + 19} stroke={stroke} strokeWidth={sw} />
        <line x1={chx} y1={ay + 20} x2={chx} y2={ay + 28} stroke={stroke} strokeWidth={sw} />
        <line x1={chx} y1={ay + 29} x2={chx} y2={ay + 37} stroke={stroke} strokeWidth={sw} />
        {/* drain (top-right) */}
        <line x1={chx} y1={ay + 15} x2={ax + 34} y2={ay + 15} stroke={stroke} strokeWidth={sw} />
        <line x1={ax + 34} y1={ay + 15} x2={ax + 34} y2={ay} stroke={stroke} strokeWidth={sw} />
        <line x1={ax + 34} y1={ay} x2={ax + G(2)} y2={ay} stroke={stroke} strokeWidth={sw} />
        {/* source (bottom-right) */}
        <line x1={chx} y1={ay + 33} x2={ax + 34} y2={ay + 33} stroke={stroke} strokeWidth={sw} />
        <line x1={ax + 34} y1={ay + 33} x2={ax + 34} y2={ay + G(2)} stroke={stroke} strokeWidth={sw} />
        <line x1={ax + 34} y1={ay + G(2)} x2={ax + G(2)} y2={ay + G(2)} stroke={stroke} strokeWidth={sw} />
        {/* channel-type arrow on the source stub: NMOS points in toward the channel, PMOS out */}
        <polygon points={nch
          ? `${chx + 3},${ay + 33} ${chx + 9},${ay + 30} ${chx + 9},${ay + 36}`
          : `${ax + 31},${ay + 33} ${ax + 25},${ay + 30} ${ax + 25},${ay + 36}`}
          fill={stroke} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
        {upright(ax + G(1), ay - 5, <text x={ax + G(1)} y={ay - 5} fill="var(--text-secondary)" fontSize={9} textAnchor="middle">{c.id}</text>)}
        {upright(ax + G(1), ay + G(2) + 13, <text x={ax + G(1)} y={ay + G(2) + 13} fill="var(--text-primary)" fontSize={8} textAnchor="middle">{c.part ?? 'MOSFET'}</text>)}
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
        {upright(cx, y + 18, <text x={cx} y={y + 18} fill="var(--text-primary)" fontSize={9} textAnchor="middle">{fmtEng(c.value ?? 0)}{UNIT[c.kind] ?? ''}</text>)}
      </g>
    )
  } else if (c.kind === 'ina125') {
    const xL = ax + G(1), xR = ax + G(6), yT = ay, yB = ay + G(2), yM = ay + G(1), yBot = ay + G(4)
    const top = yT - 12, bot = yB + 12
    inner = (
      <g>
        {/* VIN+ / VIN− input stubs (left), VO output stub (right) */}
        <line x1={ax} y1={yT} x2={xL} y2={yT} stroke={stroke} strokeWidth={sw} />
        <line x1={ax} y1={yB} x2={xL} y2={yB} stroke={stroke} strokeWidth={sw} />
        <line x1={xR} y1={yM} x2={ax + G(7)} y2={yM} stroke={stroke} strokeWidth={sw} />
        <rect x={xL} y={top} width={xR - xL} height={bot - top} rx={3} fill="var(--bg-panel)" stroke={stroke} strokeWidth={sw} />
        {/* bottom stubs: RG (×2, left/centre) and IAREF (right, separated) */}
        <line x1={ax + G(2)} y1={bot} x2={ax + G(2)} y2={yBot} stroke={stroke} strokeWidth={sw} />
        <line x1={ax + G(4)} y1={bot} x2={ax + G(4)} y2={yBot} stroke={stroke} strokeWidth={sw} />
        <line x1={ax + G(6)} y1={bot} x2={ax + G(6)} y2={yBot} stroke={stroke} strokeWidth={sw} />
        {upright(xL + 11, yT + 4, <text x={xL + 11} y={yT + 4} fill="var(--text-primary)" fontSize={11} textAnchor="middle">+</text>)}
        {upright(xL + 11, yB + 1, <text x={xL + 11} y={yB + 1} fill="var(--text-primary)" fontSize={13} textAnchor="middle">−</text>)}
        {upright(ax + G(3.5), yM + 3, <text x={ax + G(3.5)} y={yM + 3} fill="var(--text-secondary)" fontSize={9} textAnchor="middle">INA125</text>)}
        {upright(ax + G(3), yBot + 9, <text x={ax + G(3)} y={yBot + 9} fill="var(--text-secondary)" fontSize={7} textAnchor="middle">R_G</text>)}
        {upright(ax + G(6), yBot + 9, <text x={ax + G(6)} y={yBot + 9} fill="var(--text-secondary)" fontSize={7} textAnchor="middle">IAREF→GND</text>)}
        {upright(ax + G(3.5), top - 4, <text x={ax + G(3.5)} y={top - 4} fill="var(--text-secondary)" fontSize={10} textAnchor="middle">{c.id}</text>)}
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
