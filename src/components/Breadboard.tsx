// Breadboard layout (Track F, phase F-2) — transfer a schematic to a solderless board and verify
// it. Place the schematic's R/C/L parts and M2K ports by clicking holes, run jumpers, then Check
// that the board is electrically the drawn circuit. Practice colours each node live; Bench hides
// the nodes until Check. See docs/specs/breadboard.md.
import { useMemo, useRef, useState, type Dispatch, type SetStateAction, type CSSProperties } from 'react'
import {
  buildHoles, boardNets, boardWidth, boardHeight, PAD, PITCH, CHANNEL_SLOT,
  schematicExpectation, checkEquivalence, type BoardLayout, type CheckResult,
  dipPinHoles, dipCols, holeKey, DIP_TOP_ROW, DIP_BOT_ROW,
  TERMINALS, type Terminal, POWER_WIRES, PORT_TERMINAL, unboardable,
} from '../core/breadboard'
import { type Schematic, type SchKind } from '../core/schematic'
import { type SignalParams } from '../core/signal'
import { exportSvgToPng } from './exportImage'
import './Instrument.css'

type Mode = 'practice' | 'bench'
type Tool =
  | { kind: 'select' }
  | { kind: 'jumper' }
  | { kind: 'placePart'; id: string; partKind: SchKind }
  | { kind: 'placeDip'; id: string; partKind: SchKind }

const NET_COLORS = ['#f0a030', '#40c0e0', '#44dd88', '#e06fd0', '#d0d040', '#7a8cff', '#ff8855', '#55ddcc']
// A ¼ W axial resistor's body is ~0.25"; with its leads bent down it spans about 5 holes (0.5") and
// can be crammed to ~4 holes at the tightest. Enforce that floor so legs can't sit unrealistically
// close (e.g. adjacent holes). Pitch is 0.1" per hole.
const MIN_RESISTOR_HOLES = 4
// DIP function per pin (1-based), in dipPinHoles order. Pin 1 sits at the notch.
const LMC662_FN = ['OUT A', '−IN A', '+IN A', 'V−', '+IN B', '−IN B', 'OUT B', 'V+']
const INA125_FN = ['V+', 'SLEEP', 'V−', 'VREFOUT', 'IAREF', 'VIN−', 'VIN+', 'RG', 'RG', 'VO', 'Sense', 'VREFCOM', 'VREFBG', 'VREF2.5', 'VREF5', 'VREF10']
const DIP_FN: Record<string, string[]> = { lmc662: LMC662_FN, ina125: INA125_FN }
const DIP_NAME: Record<string, string> = { lmc662: 'LMC662', ina125: 'INA125' }
// 0-based pin indices of the V+/V− pins per DIP (for colouring the power pins).
const DIP_RAILS: Record<string, { vpos: number; vneg: number }> = { lmc662: { vpos: 7, vneg: 3 }, ina125: { vpos: 0, vneg: 2 } }

interface Props {
  schematic: Schematic
  setSchematic: Dispatch<SetStateAction<Schematic>>
  board: BoardLayout
  setBoard: Dispatch<SetStateAction<BoardLayout>>
  // Generator settings (W1/W2) travel inside a saved lab so a loaded circuit runs at the right
  // input level — e.g. a gain-10 amp wants a ~0.3 V input, not the 1 V default that clips.
  generators?: { w1: SignalParams; w2: SignalParams }
  onLoadGenerators?: (w1: SignalParams, w2: SignalParams) => void
  // Push the current schematic onto the shared undo history before a lab Open replaces it.
  snapshotSchematic?: () => void
}

export default function Breadboard({ schematic, setSchematic, board, setBoard, generators, onLoadGenerators, snapshotSchematic }: Props) {
  const holes = useMemo(() => buildHoles(), [])
  const holeByKey = useMemo(() => new Map(holes.map((h) => [h.key, h])), [holes])
  const exp = useMemo(() => schematicExpectation(schematic), [schematic])
  const nets = useMemo(() => boardNets(holes, board.jumpers), [holes, board.jumpers])

  const [mode, setMode] = useState<Mode>('practice')
  const [tool, setTool] = useState<Tool>({ kind: 'select' })
  const [pending, setPending] = useState<string | null>(null)
  const [hoverNet, setHoverNet] = useState<string | null>(null)
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [revealed, setRevealed] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null) // for the jumper rubber-band

  const W = boardWidth(), H = boardHeight()
  const STRIP = 48                 // height of each fixed M2K terminal strip
  const OY = STRIP                 // board content shifts down to leave room for the top strip
  const H2 = STRIP + H + STRIP     // total SVG height (top strip + board + bottom strip)
  const RM = 42                    // right margin so the rail labels (GND/V+/V−) are not clipped
  const W2 = W + RM                // total SVG width
  const railY = (slot: number) => PAD + slot * PITCH + OY
  const termByKey = useMemo(() => new Map(TERMINALS.map((t) => [t.key, t])), [])
  const termX = (t: Terminal) => PAD + (t.col - 1) * PITCH
  const termY = (t: Terminal) => (t.side === 'top' ? STRIP - 18 : OY + H + 18)
  const TERM_COLOR: Record<string, string> = { pos: '#e04040', neg: '#4a9eff', gnd: '#c9cdd2', signal: '#8fb3cf' }
  // Absolute SVG position of any node key — a board hole or a fixed M2K terminal.
  const pos = (key: string) => {
    const h = holeByKey.get(key)
    if (h) return { x: h.x, y: h.y + OY }
    const t = termByKey.get(key)!
    return { x: termX(t), y: termY(t) }
  }

  // Colour the nodes the student has actually wired (any net with a leg / port / jumper).
  const activeColor = useMemo(() => {
    const used = new Set<string>()
    for (const p of board.parts) { used.add(nets.get(p.aHole)!); used.add(nets.get(p.bHole)!) }
    for (const j of board.jumpers) { used.add(nets.get(j.a)!); used.add(nets.get(j.b)!) }
    for (const d of (board.dips ?? [])) for (const k of (dipPinHoles(d.kind, d.col) ?? [])) used.add(nets.get(k)!)
    const m = new Map<string, string>()
    let i = 0
    for (const n of used) { if (n) { m.set(n, NET_COLORS[i % NET_COLORS.length]); i++ } }
    return m
  }, [board, nets])

  const showNets = mode === 'practice' || revealed
  // Wire colouring follows the power convention: a jumper touching a terminal, OR sitting on the
  // V+/V−/GND net (e.g. one daisy-chained off the rail), takes that supply's colour. Any other
  // hole-to-hole jumper keeps its node colour.
  const wireColor = (ak: string, bk: string) => {
    const t = termByKey.get(ak) ?? termByKey.get(bk)
    if (t) return TERM_COLOR[t.color]
    const sup = supplyOf(ak) ?? supplyOf(bk)
    if (sup) return SUPPLY_LINE[sup]
    const jnet = nets.get(ak)
    return (showNets && jnet && activeColor.get(jnet)) || '#c9cdd2'
  }
  // Which supply a node carries, by comparing its net to the V+/V−/GND terminal nets. Drives the
  // bus-rail colour-coding (a rail is whatever it is wired to — by default V+, V−, or GND).
  const supplyOf = (key: string): 'pos' | 'neg' | 'gnd' | null => {
    const net = nets.get(key)
    if (!net) return null
    if (net === nets.get(PORT_TERMINAL['V+'])) return 'pos'
    if (net === nets.get(PORT_TERMINAL['V-'])) return 'neg'
    if (net === nets.get(PORT_TERMINAL['GND'])) return 'gnd'
    return null
  }
  const SUPPLY_LINE: Record<string, string> = { pos: '#e04040', neg: '#4a9eff', gnd: '#c9cdd2' }
  const SUPPLY_HOLE: Record<string, string> = { pos: '#5a2a2a', neg: '#23304a', gnd: '#3a3a3a' }
  const placedPart = new Map(board.parts.map((p) => [p.id, p]))
  const placedDip = new Map((board.dips ?? []).map((d) => [d.id, d]))
  // Components with no board footprint (op-amps/in-amps) → this circuit can't be transferred.
  const blockers = useMemo(() => unboardable(schematic), [schematic])
  const boardable = blockers.length === 0

  // Non-blocking nudge: if a + input is wired into the circuit but its − partner is left floating,
  // remind the student to tie it (GND for single-ended, the reference node for differential). The
  // real M2K inputs float, so an un-wired − reads garbage — but differential is valid, so we warn
  // rather than block.
  const floatingMinus = useMemo(() => {
    const wired = (k?: string) => !!k && board.jumpers.some((j) => j.a === k || j.b === k)
    const out: string[] = []
    for (const [plus, minus, label] of [['1+', '1-', '1−'], ['2+', '2-', '2−']] as const) {
      if (wired(PORT_TERMINAL[plus]) && !wired(PORT_TERMINAL[minus]))
        out.push(`${label} input is floating — tie it to GND for a single-ended measurement, or to your reference node for a differential one.`)
    }
    return out
  }, [board.jumpers])

  function onNode(key: string, isTerminal = false) {
    setCheck(null)
    if (tool.kind === 'jumper') {
      if (!pending) setPending(key)
      else { if (pending !== key) setBoard((b) => ({ ...b, jumpers: [...b.jumpers, { a: pending, b: key }] })); setPending(null) }
      return
    }
    if (isTerminal) return // fixed M2K terminals: only jumpers attach to them
    if (tool.kind === 'placePart') {
      if (!pending) { setPending(key); return }
      if (pending === key) { setPending(null); return }
      // A through-hole resistor's leads can't be crammed closer than its body allows. Keep the first
      // leg pending so the student just clicks a hole farther out.
      if (tool.partKind === 'resistor') {
        const A = pos(pending), B = pos(key)
        const span = Math.hypot(B.x - A.x, B.y - A.y) / PITCH
        if (span < MIN_RESISTOR_HOLES) {
          setCheck({ ok: false, message: `Too tight: a resistor's legs span ~5 holes (0.5"). Place them at least ${MIN_RESISTOR_HOLES} holes apart — pick a farther hole.` })
          return
        }
      }
      const part = { id: tool.id, kind: tool.partKind, aHole: pending, bHole: key }
      setBoard((b) => ({ ...b, parts: [...b.parts.filter((p) => p.id !== tool.id), part] }))
      setPending(null); setTool({ kind: 'select' })
      return
    }
    if (tool.kind === 'placeDip') {
      const h = holeByKey.get(key)!
      // Anchor must be the top-left pin: a hole in the channel-adjacent top row, with room to span.
      if (h.row !== DIP_TOP_ROW || !dipPinHoles(tool.partKind, h.col)) {
        setCheck({ ok: false, message: `Click a hole in row ${DIP_TOP_ROW} so the chip straddles the channel (needs ${dipCols(tool.partKind)} columns).` })
        return
      }
      const dip = { id: tool.id, kind: tool.partKind, col: h.col }
      setBoard((b) => ({ ...b, dips: [...(b.dips ?? []).filter((d) => d.id !== tool.id), dip] }))
      setTool({ kind: 'select' })
      return
    }
  }

  function runCheck() { if (!boardable) return; setCheck(checkEquivalence(schematic, board, holes)); if (mode === 'bench') setRevealed(true) }

  // Track the pointer in SVG coordinates while a jumper is in progress, for the rubber-band preview.
  function onSvgMove(e: React.MouseEvent<SVGSVGElement>) {
    if (tool.kind !== 'jumper' || !pending) { if (cursor) setCursor(null); return }
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!ctm) return
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    setCursor({ x: p.x, y: p.y })
  }

  // F-3 save/load: a "lab" bundle holds the circuit AND its board layout in one .json, so opening
  // it restores both and Check works immediately. Mirrors the Schematic editor's Save (SCH-3):
  // native Save dialog when available, else a download fallback.
  const fileRef = useRef<HTMLInputElement>(null)
  async function saveLab() {
    const json = JSON.stringify({ kind: 'm2k-lab', version: 2, schematic, board, generators }, null, 2)
    const sfp = (window as unknown as {
      showSavePicker?: (o: {
        suggestedName?: string
        types?: { description?: string; accept: Record<string, string[]> }[]
      }) => Promise<{ name: string; createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }>
    }).showSavePicker
    if (typeof sfp === 'function') {
      try {
        const handle = await sfp({
          suggestedName: 'm2k-lab.json',
          types: [{ description: 'M2K lab (circuit + board)', accept: { 'application/json': ['.json'] } }],
        })
        const w = await handle.createWritable(); await w.write(json); await w.close()
        setCheck({ ok: true, message: 'saved ' + handle.name }); return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
    }
    let name = prompt('Save lab as:', 'm2k-lab.json')
    if (name === null) return
    name = name.trim() || 'm2k-lab.json'
    if (!name.toLowerCase().endsWith('.json')) name += '.json'
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = name; a.click()
    URL.revokeObjectURL(url)
    setCheck({ ok: true, message: 'saved ' + name })
  }
  function openLab(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result))
        const s = d.schematic, b = d.board
        const isLab = s && Array.isArray(s.components) && Array.isArray(s.wires) && b && Array.isArray(b.parts) && Array.isArray(b.jumpers)
        const isCircuit = Array.isArray(d.components) && Array.isArray(d.wires)
        if (isLab) {
          snapshotSchematic?.()
          setSchematic({ components: s.components, wires: s.wires })
          setBoard({ parts: b.parts, jumpers: b.jumpers, ports: Array.isArray(b.ports) ? b.ports : [], dips: Array.isArray(b.dips) ? b.dips : [] })
          const g = d.generators
          if (g && g.w1 && g.w2 && onLoadGenerators) onLoadGenerators(g.w1, g.w2)
          setTool({ kind: 'select' }); setPending(null)
          setCheck({ ok: true, message: 'loaded ' + f.name })
        } else if (isCircuit) {
          // A plain circuit file: load the circuit and start the board empty so the student places it.
          snapshotSchematic?.()
          setSchematic({ components: d.components, wires: d.wires })
          setBoard({ parts: [], jumpers: [], ports: [], dips: [] })
          setTool({ kind: 'select' }); setPending(null)
          setCheck({ ok: true, message: `loaded circuit ${f.name} — board starts empty, place the parts` })
        } else {
          setCheck({ ok: false, message: 'not a valid circuit or lab file' })
        }
      } catch {
        setCheck({ ok: false, message: 'could not read file' })
      }
    }
    reader.readAsText(f)
    e.target.value = '' // allow re-loading the same file
  }

  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header">
          <span className="display-title">Breadboard</span>
          <div style={{ flex: 1, display: 'flex', gap: 14, alignItems: 'center', overflow: 'hidden', margin: '0 12px' }}>
            {!boardable && (
              <span title={`These parts have no breadboard footprint: ${blockers.map((b) => `${b.id} (${b.kind})`).join(', ')}`}
                style={{ fontSize: 12, color: '#ff7a7a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                ⛔ Can't build on a board: {blockers.map((b) => b.id).join(', ')} ({blockers[0].kind}) has no footprint yet.
              </span>
            )}
            {boardable && check && (
              <span title={check.message} style={{ fontSize: 12, color: check.ok ? 'var(--theory-color)' : '#ffaa55', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{check.message}</span>
            )}
            {boardable && floatingMinus.length > 0 && (
              <span title={floatingMinus.join('  ')} style={{ fontSize: 12, color: '#ffbf00', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                ⚠ {floatingMinus.length === 1 ? floatingMinus[0] : `${floatingMinus.length} − inputs floating — tie each to a node`}
              </span>
            )}
          </div>
          <div className="display-controls">
            <button className={`run-btn ${mode === 'practice' ? 'active' : ''}`} onClick={() => { setMode('practice'); setRevealed(false) }}>Practice</button>
            <button className={`run-btn ${mode === 'bench' ? 'active' : ''}`} onClick={() => { setMode('bench'); setRevealed(false); setHoverNet(null) }}>Bench</button>
            <button className={`run-btn ${boardable ? 'active' : ''}`} onClick={runCheck} disabled={!boardable}
              title={boardable ? 'Check board vs schematic' : 'This circuit has no breadboard footprint'} style={!boardable ? { opacity: 0.5 } : undefined}>✓ Check</button>
            <button className="run-btn" onClick={saveLab}>Save</button>
            <button className="run-btn" onClick={() => fileRef.current?.click()}>Open</button>
            <button className="run-btn" title="Save the board layout as a PNG for your prelab"
              onClick={() => { if (svgRef.current) exportSvgToPng(svgRef.current, 'breadboard.png', { light: true }).catch((e) => setCheck({ ok: false, message: `Export failed: ${e.message}` })) }}>
              Export PNG
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={openLab} />
          </div>
        </div>
        <div className="plotly-display" style={{ overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 8 }}>
          <svg ref={svgRef} viewBox={`0 0 ${W2} ${H2}`} width={W2} height={H2} style={{ maxWidth: '100%', height: 'auto' }}
            onMouseMove={onSvgMove} onMouseLeave={() => cursor && setCursor(null)}>
            {/* fixed M2K adaptor-board connector strips, top & bottom */}
            <rect x={2} y={2} width={W - 4} height={STRIP - 8} rx={5} fill="#0f2c49" stroke="#1d4d7a" />
            <rect x={2} y={OY + H + 6} width={W - 4} height={STRIP - 8} rx={5} fill="#0f2c49" stroke="#1d4d7a" />
            {/* board body */}
            <rect x={2} y={OY + 2} width={W - 4} height={H - 4} rx={8} fill="#15171a" stroke="#333" />
            {([[0, 'TP'], [1, 'TN'], [15, 'BP'], [16, 'BN']] as const).map(([s, row]) => {
              const fn = supplyOf(holeKey(row, 1))
              return (
                <line key={s} x1={PAD - 10} y1={railY(s)} x2={W - PAD + 10} y2={railY(s)}
                  stroke={fn ? SUPPLY_LINE[fn] : '#555'} strokeOpacity={0.55} strokeWidth={2.5} />
              )
            })}
            {/* function label on each rail (outer = GND, top inner = V+, bottom inner = V−) */}
            {([[0, 'GND', 'gnd'], [1, 'V+', 'pos'], [15, 'V−', 'neg'], [16, 'GND', 'gnd']] as const).map(([s, lbl, c]) => (
              <text key={'rl' + s} x={W - PAD + 12} y={railY(s) + 4} fontSize={13} fontWeight={800}
                fill={TERM_COLOR[c]} textAnchor="start">{lbl}</text>
            ))}
            <rect x={2} y={railY(CHANNEL_SLOT) - PITCH / 2} width={W - 4} height={PITCH} fill="#0d0d0d" />
            {holes.map((h) => {
              const net = nets.get(h.key)!
              const aCol = showNets ? activeColor.get(net) : undefined
              const hover = mode === 'practice' && hoverNet === net
              const railFn = (h.kind === 'railP' || h.kind === 'railN') ? supplyOf(h.key) : null
              const base = railFn ? SUPPLY_HOLE[railFn] : '#2b2b2b'
              const fill = hover ? '#ffffff' : (aCol ?? base)
              const r = (hover || pending === h.key) ? 4.4 : (aCol ? 3.6 : 3)
              const cy = h.y + OY
              return (
                <g key={h.key} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => { if (mode === 'practice') setHoverNet(net) }}
                  onMouseLeave={() => setHoverNet(null)}
                  onClick={() => onNode(h.key)}>
                  {/* generous invisible hit target (the whole cell) so clicks don't need to be precise */}
                  <circle cx={h.x} cy={cy} r={PITCH / 2 - 1} fill="transparent" />
                  <circle cx={h.x} cy={cy} r={r} fill={fill}
                    stroke={pending === h.key ? '#fff' : '#000'} strokeWidth={pending === h.key ? 1.5 : 0.5}
                    style={{ pointerEvents: 'none' }} />
                </g>
              )
            })}
            {/* standard power distribution — always present, coloured by terminal, not deletable */}
            {POWER_WIRES.map((w, i) => {
              const a = pos(w.a), b = pos(w.b)
              const col = TERM_COLOR[w.color]
              return (
                <g key={'pw' + i} style={{ pointerEvents: 'none' }}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#000" strokeOpacity={0.5} strokeWidth={5} strokeLinecap="round" />
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={3} strokeLinecap="round" strokeOpacity={0.92} />
                  <circle cx={a.x} cy={a.y} r={4.4} fill={col} stroke="#000" strokeWidth={1} />
                  <circle cx={b.x} cy={b.y} r={4.4} fill={col} stroke="#000" strokeWidth={1} />
                </g>
              )
            })}
            {board.jumpers.map((j, i) => {
              const a = pos(j.a), b = pos(j.b)
              const col = wireColor(j.a, j.b)
              return (
                <g key={'j' + i} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default', pointerEvents: tool.kind === 'select' ? 'auto' : 'none' }}
                  onClick={() => { if (tool.kind === 'select') { setBoard((bb) => ({ ...bb, jumpers: bb.jumpers.filter((_, k) => k !== i) })); setCheck(null) } }}>
                  {/* shadow lifts the jumper visually above the board */}
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#000" strokeOpacity={0.55} strokeWidth={5.5} strokeLinecap="round" />
                  {/* coloured by its node, so it matches the bus/column it joins */}
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={3} strokeLinecap="round" />
                  {/* junction dots = the only points it actually connects */}
                  <circle cx={a.x} cy={a.y} r={4.6} fill={col} stroke="#000" strokeWidth={1} />
                  <circle cx={b.x} cy={b.y} r={4.6} fill={col} stroke="#000" strokeWidth={1} />
                </g>
              )
            })}
            {board.parts.map((p) => {
              const a = pos(p.aHole), b = pos(p.bHole)
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
              return (
                <g key={p.id} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default', pointerEvents: tool.kind === 'select' ? 'auto' : 'none' }}
                  onClick={() => { if (tool.kind === 'select') { setBoard((bb) => ({ ...bb, parts: bb.parts.filter((x) => x.id !== p.id) })); setCheck(null) } }}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--ch1-color)" strokeWidth={2} />
                  <rect x={mx - 11} y={my - 7} width={22} height={14} rx={2} fill="var(--bg-panel)" stroke="var(--ch1-color)" />
                  <text x={mx} y={my + 4} fontSize={9} fill="var(--text-primary)" textAnchor="middle">{p.id}</text>
                </g>
              )
            })}
            {(board.dips ?? []).map((d) => {
              const pins = dipPinHoles(d.kind, d.col); if (!pins) return null
              const n = dipCols(d.kind)
              const tl = pos(holeKey(DIP_TOP_ROW, d.col)), br = pos(holeKey(DIP_BOT_ROW, d.col + n - 1))
              const bx = tl.x - 7, by = tl.y - 7, bw = (br.x - tl.x) + 14, bh = (br.y - tl.y) + 14
              return (
                <g key={d.id} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default', pointerEvents: tool.kind === 'select' ? 'auto' : 'none' }}
                  onClick={() => { if (tool.kind === 'select') { setBoard((bb) => ({ ...bb, dips: (bb.dips ?? []).filter((x) => x.id !== d.id) })); setCheck(null) } }}>
                  <rect x={bx} y={by} width={bw} height={bh} rx={3} fill="#1b1b1f" stroke="#888" strokeWidth={1} />
                  {/* notch on the left edge marks pin-1 end (datasheet orientation) */}
                  <path d={`M ${bx + 5} ${by + bh / 2 - 5} a 5 5 0 0 0 0 10`} fill="none" stroke="#888" strokeWidth={1} />
                  {pins.map((k, i) => {
                    const h = pos(k); const net = nets.get(k)!
                    const col = (showNets && activeColor.get(net)) || '#cfcfcf'
                    const isBottom = i < n           // pins 1..n on the bottom row, n+1..2n on top
                    const numY = isBottom ? h.y + 12 : h.y - 7
                    const rails = DIP_RAILS[d.kind]
                    const numCol = rails && i === rails.vpos ? '#e04040' : rails && i === rails.vneg ? '#4a9eff' : '#9aa0a6'
                    return (
                      <g key={i}>
                        <circle cx={h.x} cy={h.y} r={3.2} fill={col} stroke="#000" strokeWidth={0.5}>
                          <title>{`pin ${i + 1}: ${(DIP_FN[d.kind] ?? [])[i] ?? ''}`}</title>
                        </circle>
                        <text x={h.x} y={numY} fontSize={9} fontWeight={800} fill={numCol} textAnchor="middle">{i + 1}</text>
                      </g>
                    )
                  })}
                  <text x={(bx + bx + bw) / 2} y={by + bh / 2 + 3} fontSize={8} fill="#cfcfcf" textAnchor="middle">{d.id} · {DIP_NAME[d.kind] ?? d.kind}</text>
                </g>
              )
            })}
            {TERMINALS.map((t) => {
              const x = termX(t), y = termY(t)
              const net = nets.get(t.key)
              const aCol = showNets && net ? activeColor.get(net) : undefined
              const c = TERM_COLOR[t.color]
              const hover = mode === 'practice' && hoverNet === net
              const labelY = t.side === 'top' ? y - 13 : y + 19
              return (
                <g key={t.key} style={{ cursor: 'pointer' }}
                  onMouseEnter={() => { if (mode === 'practice' && net) setHoverNet(net) }}
                  onMouseLeave={() => setHoverNet(null)}
                  onClick={() => onNode(t.key, true)}>
                  {/* generous invisible hit target around the pad + its label */}
                  <rect x={x - 13} y={y - 16} width={26} height={32} fill="transparent" />
                  <rect x={x - 9} y={y - 9} width={18} height={18} rx={3}
                    fill={hover ? '#ffffff' : (aCol ?? '#15202c')}
                    stroke={pending === t.key ? '#fff' : c} strokeWidth={pending === t.key ? 2 : 1.5} />
                  <circle cx={x} cy={y} r={3.1} fill={c} stroke="#000" strokeWidth={0.5} />
                  <text x={x} y={labelY} fontSize={9} fontWeight={700} fill={c} textAnchor="middle">{t.name}</text>
                </g>
              )
            })}
            {/* rubber-band: from the first jumper click to the pointer */}
            {tool.kind === 'jumper' && pending && cursor && (
              <line x1={pos(pending).x} y1={pos(pending).y} x2={cursor.x} y2={cursor.y}
                stroke={wireColor(pending, pending)} strokeOpacity={0.8} strokeWidth={2.5}
                strokeDasharray="5 4" strokeLinecap="round" style={{ pointerEvents: 'none' }} />
            )}
          </svg>
        </div>
      </div>

      <div className="settings-panel">
        <div className="section-title">Place from schematic</div>
        {!boardable && (
          <div style={{ fontSize: 11, color: '#ff7a7a', lineHeight: 1.5, marginBottom: 6 }}>
            This circuit can't be transferred to a breadboard: {blockers.map((b) => `${b.id} (${b.kind})`).join(', ')} {blockers.length === 1 ? 'has' : 'have'} no board footprint yet. The breadboard currently supports passive and 2-terminal parts; op-amp / in-amp boarding is still to come.
          </div>
        )}
        {exp.parts.length === 0 && exp.dips.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Draw a circuit in the Circuit tab above.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {exp.parts.map((p) => (
              <button key={p.id} style={chip(placedPart.has(p.id), tool.kind === 'placePart' && tool.id === p.id)}
                onClick={() => { setTool({ kind: 'placePart', id: p.id, partKind: p.kind }); setPending(null); setCheck(null) }}>
                {placedPart.has(p.id) ? '✓ ' : ''}{p.id}
              </button>
            ))}
            {exp.dips.map((d) => (
              <button key={d.id} style={chip(placedDip.has(d.id), tool.kind === 'placeDip' && tool.id === d.id)}
                onClick={() => { setTool({ kind: 'placeDip', id: d.id, partKind: d.kind }); setPending(null); setCheck(null) }}>
                {placedDip.has(d.id) ? '✓ ' : ''}{d.id} (DIP)
              </button>
            ))}
          </div>
        )}

        {exp.dips.some((d) => d.kind === 'lmc662') && (
          <>
            <div className="section-title">LMC662 pinout</div>
            <svg viewBox="0 0 240 150" preserveAspectRatio="xMidYMid meet" role="img"
              aria-label="LMC662 8-pin DIP pinout" style={{ display: 'block', width: '100%', height: 132, flexShrink: 0, margin: '4px 0' }}>
              {/* top pins 8,7,6,5 (left→right); bottom pins 1,2,3,4 — matches the chip on the board */}
              {([['V+', 8], ['OUT B', 7], ['−IN B', 6], ['+IN B', 5]] as const).map(([fn, p], j) => {
                const x = 54 + j * 44
                const c = p === 8 ? '#e04040' : '#cfcfcf'
                return (
                  <g key={p}>
                    <line x1={x} y1={48} x2={x} y2={38} stroke="#888" strokeWidth={1.5} />
                    <circle cx={x} cy={38} r={3} fill={c} />
                    <text x={x} y={28} fontSize={11} fontWeight={800} fill={c} textAnchor="middle">{p}</text>
                    <text x={x} y={17} fontSize={9} fill="var(--text-secondary)" textAnchor="middle">{fn}</text>
                  </g>
                )
              })}
              <rect x={36} y={48} width={168} height={54} rx={4} fill="#1b1b1f" stroke="#888" strokeWidth={1.5} />
              <path d={`M ${36} ${68} a 7 7 0 0 0 0 14`} fill="#0c0d0f" stroke="#888" strokeWidth={1.5} />
              <text x={120} y={79} fontSize={10} fill="#9aa0a6" textAnchor="middle">LMC662</text>
              {([['OUT A', 1], ['−IN A', 2], ['+IN A', 3], ['V−', 4]] as const).map(([fn, p], j) => {
                const x = 54 + j * 44
                const c = p === 4 ? '#4a9eff' : '#cfcfcf'
                return (
                  <g key={p}>
                    <line x1={x} y1={102} x2={x} y2={112} stroke="#888" strokeWidth={1.5} />
                    <circle cx={x} cy={112} r={3} fill={c} />
                    <text x={x} y={126} fontSize={11} fontWeight={800} fill={c} textAnchor="middle">{p}</text>
                    <text x={x} y={138} fontSize={9} fill="var(--text-secondary)" textAnchor="middle">{fn}</text>
                  </g>
                )
              })}
            </svg>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 2 }}>
              Notch / pin 1 at the lower-left — same orientation as the chip on the board. Your op-amp uses
              <b> section A</b>: +IN A (3), −IN A (2), OUT A (1); power <b style={{ color: '#e04040' }}>V+</b> (8) and <b style={{ color: '#4a9eff' }}>V−</b> (4).
            </div>
          </>
        )}

        {exp.dips.some((d) => d.kind === 'ina125') && (
          <>
            <div className="section-title">INA125 pinout (16-pin)</div>
            <svg viewBox="0 0 200 232" preserveAspectRatio="xMidYMid meet" role="img" aria-label="INA125 16-pin DIP pinout"
              style={{ display: 'block', width: '100%', height: 224, flexShrink: 0, margin: '2px 0' }}>
              <rect x={72} y={16} width={56} height={204} rx={4} fill="#1b1b1f" stroke="#888" strokeWidth={1.5} />
              <path d={`M ${86} 16 a 14 7 0 0 0 28 0`} fill="#0c0d0f" stroke="#888" strokeWidth={1.5} />
              {/* left column pins 1..8 (top→bottom); right column pins 16..9 */}
              {([[1, 'V+', 'pos'], [2, 'SLEEP', ''], [3, 'V−', 'neg'], [4, 'VREFOUT', ''], [5, 'IAREF', ''], [6, 'VIN−', ''], [7, 'VIN+', ''], [8, 'RG', '']] as const).map(([p, fn, c], i) => {
                const y = 38 + i * 24, col = c === 'pos' ? '#e04040' : c === 'neg' ? '#4a9eff' : '#cfcfcf'
                return (
                  <g key={p}>
                    <line x1={60} y1={y} x2={72} y2={y} stroke="#888" strokeWidth={1.5} />
                    <text x={84} y={y + 3} fontSize={9} fontWeight={700} fill={col} textAnchor="end">{p}</text>
                    <text x={56} y={y + 3} fontSize={9} fill="var(--text-secondary)" textAnchor="end">{fn}</text>
                  </g>
                )
              })}
              {([[16, 'VREF10', ''], [15, 'VREF5', ''], [14, 'VREF2.5', ''], [13, 'VREFBG', ''], [12, 'VREFCOM', ''], [11, 'Sense', ''], [10, 'VO', ''], [9, 'RG', '']] as const).map(([p, fn], i) => {
                const y = 38 + i * 24
                return (
                  <g key={p}>
                    <line x1={128} y1={y} x2={140} y2={y} stroke="#888" strokeWidth={1.5} />
                    <text x={116} y={y + 3} fontSize={9} fontWeight={700} fill="#cfcfcf" textAnchor="start">{p}</text>
                    <text x={144} y={y + 3} fontSize={9} fill="var(--text-secondary)" textAnchor="start">{fn}</text>
                  </g>
                )
              })}
            </svg>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 4 }}>
              <b>Signal:</b> wire <b>VIN+</b> (7), <b>VIN−</b> (6), <b>VO</b> (10), and external <b>R_G</b> across
              <b> 8–9</b> (sets gain). <b>Power:</b> <b style={{ color: '#e04040' }}>V+</b> (1) /
              <b style={{ color: '#4a9eff' }}>V−</b> (3) to the rails.
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 4 }}>
              <b style={{ color: 'var(--ch1-color)' }}>Required strapping</b> (the chip won't work without it):
              <b> SLEEP</b> (2)→V+, <b>VREFout</b> (4)→<b>VREF2.5</b> (14), <b>IAref</b> (5)→GND,
              <b> Sense</b> (11)→<b>VO</b> (10), <b>VREFcom</b> (12)→GND. The board <b>Check</b> enforces each one.
            </div>
          </>
        )}

        <div className="section-title">M2K terminals</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          The M2K connections are the fixed strips above and below the board — always there, like the
          real adaptor board. Use the <b>Jumper</b> tool to wire one into your circuit.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10, marginTop: 6 }}>
          <span style={{ color: '#e04040' }}>● V+ (red)</span>
          <span style={{ color: '#4a9eff' }}>● V− (blue)</span>
          <span style={{ color: '#c9cdd2' }}>● GND</span>
          <span style={{ color: '#8fb3cf' }}>● signals (1±, 2±, W1, W2, TI)</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: 6 }}>
          The power rails come pre-wired (kept that way on purpose): <b style={{ color: '#c9cdd2' }}>GND</b> on
          both outer rails, <b style={{ color: '#e04040' }}>V+</b> on the top inner rail,
          <b style={{ color: '#4a9eff' }}>V−</b> on the bottom inner rail — build from there. Jumpers from a
          terminal carry that terminal's colour.
        </div>

        <div className="section-title">Tools</div>
        <div className="wave-selector">
          <button className={tool.kind === 'select' ? 'active' : ''} onClick={() => { setTool({ kind: 'select' }); setPending(null) }}>Select</button>
          <button className={tool.kind === 'jumper' ? 'active' : ''} onClick={() => { setTool({ kind: 'jumper' }); setPending(null) }}>Jumper</button>
          <button onClick={() => { setBoard({ parts: [], jumpers: [], ports: [], dips: [] }); setCheck(null); setPending(null) }}>Clear</button>
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.6 }}>
          {tool.kind === 'placePart' ? `Placing ${tool.id}: click two holes for its legs.`
            : tool.kind === 'placeDip' ? `Placing ${tool.id}: click a hole in row ${DIP_TOP_ROW} (top-left pin); the chip drops across the channel.`
            : tool.kind === 'jumper' ? 'Jumper: click two points — a hole or an M2K terminal — to wire them together.'
            : 'Select: click a placed part or jumper to remove it.'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6 }}>
          {mode === 'practice' ? 'Practice: each node is coloured as you wire; hover a hole to highlight its node.'
            : 'Bench: nodes stay hidden until you press Check.'}
        </div>
      </div>
    </div>
  )
}

function chip(placed: boolean, active: boolean): CSSProperties {
  return {
    fontSize: 11, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--accent-blue)' : placed ? 'var(--theory-color)' : 'var(--border)'}`,
    color: placed ? 'var(--theory-color)' : 'var(--text-primary)',
    background: active ? 'rgba(74,158,255,0.15)' : 'transparent',
  }
}
