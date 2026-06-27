// Breadboard layout (Track F, phase F-2) — transfer a schematic to a solderless board and verify
// it. Place the schematic's R/C/L parts and M2K ports by clicking holes, run jumpers, then Check
// that the board is electrically the drawn circuit. Practice colours each node live; Bench hides
// the nodes until Check. See docs/specs/breadboard.md.
import { useMemo, useRef, useState, type Dispatch, type SetStateAction, type CSSProperties } from 'react'
import {
  buildHoles, boardNets, boardWidth, boardHeight, PAD, PITCH, CHANNEL_SLOT,
  schematicExpectation, checkEquivalence, type BoardLayout, type CheckResult,
  dipPinHoles, dipCols, holeKey, DIP_TOP_ROW, DIP_BOT_ROW,
} from '../core/breadboard'
import { type Schematic, type SchKind } from '../core/schematic'
import { type SignalParams } from '../core/signal'
import './Instrument.css'

type Mode = 'practice' | 'bench'
type Tool =
  | { kind: 'select' }
  | { kind: 'jumper' }
  | { kind: 'placePart'; id: string; partKind: SchKind }
  | { kind: 'placeDip'; id: string; partKind: SchKind }
  | { kind: 'placePort'; port: string }

const NET_COLORS = ['#f0a030', '#40c0e0', '#44dd88', '#e06fd0', '#d0d040', '#7a8cff', '#ff8855', '#55ddcc']

interface Props {
  schematic: Schematic
  setSchematic: Dispatch<SetStateAction<Schematic>>
  board: BoardLayout
  setBoard: Dispatch<SetStateAction<BoardLayout>>
  // Generator settings (W1/W2) travel inside a saved lab so a loaded circuit runs at the right
  // input level — e.g. a gain-10 amp wants a ~0.3 V input, not the 1 V default that clips.
  generators?: { w1: SignalParams; w2: SignalParams }
  onLoadGenerators?: (w1: SignalParams, w2: SignalParams) => void
}

export default function Breadboard({ schematic, setSchematic, board, setBoard, generators, onLoadGenerators }: Props) {
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

  const W = boardWidth(), H = boardHeight()
  const railY = (slot: number) => PAD + slot * PITCH
  const pos = (key: string) => holeByKey.get(key)!

  // Colour the nodes the student has actually wired (any net with a leg / port / jumper).
  const activeColor = useMemo(() => {
    const used = new Set<string>()
    for (const p of board.parts) { used.add(nets.get(p.aHole)!); used.add(nets.get(p.bHole)!) }
    for (const p of board.ports) used.add(nets.get(p.hole)!)
    for (const j of board.jumpers) { used.add(nets.get(j.a)!); used.add(nets.get(j.b)!) }
    for (const d of (board.dips ?? [])) for (const k of (dipPinHoles(d.kind, d.col) ?? [])) used.add(nets.get(k)!)
    const m = new Map<string, string>()
    let i = 0
    for (const n of used) { if (n) { m.set(n, NET_COLORS[i % NET_COLORS.length]); i++ } }
    return m
  }, [board, nets])

  const showNets = mode === 'practice' || revealed
  const placedPart = new Map(board.parts.map((p) => [p.id, p]))
  const placedDip = new Map((board.dips ?? []).map((d) => [d.id, d]))
  const placedPort = new Map(board.ports.map((p) => [p.port, p]))

  function onHole(key: string) {
    setCheck(null)
    if (tool.kind === 'jumper') {
      if (!pending) setPending(key)
      else { if (pending !== key) setBoard((b) => ({ ...b, jumpers: [...b.jumpers, { a: pending, b: key }] })); setPending(null) }
      return
    }
    if (tool.kind === 'placePart') {
      if (!pending) { setPending(key); return }
      if (pending === key) { setPending(null); return }
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
    if (tool.kind === 'placePort') {
      const port = tool.port
      setBoard((b) => ({ ...b, ports: [...b.ports.filter((p) => p.port !== port), { port, hole: key }] }))
      setTool({ kind: 'select' })
    }
  }

  function runCheck() { setCheck(checkEquivalence(schematic, board, holes)); if (mode === 'bench') setRevealed(true) }

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
        const isLab = s && Array.isArray(s.components) && Array.isArray(s.wires) && b && Array.isArray(b.parts) && Array.isArray(b.jumpers) && Array.isArray(b.ports)
        const isCircuit = Array.isArray(d.components) && Array.isArray(d.wires)
        if (isLab) {
          setSchematic({ components: s.components, wires: s.wires })
          setBoard({ parts: b.parts, jumpers: b.jumpers, ports: b.ports, dips: Array.isArray(b.dips) ? b.dips : [] })
          const g = d.generators
          if (g && g.w1 && g.w2 && onLoadGenerators) onLoadGenerators(g.w1, g.w2)
          setTool({ kind: 'select' }); setPending(null)
          setCheck({ ok: true, message: 'loaded ' + f.name })
        } else if (isCircuit) {
          // A plain circuit file: load the circuit and start the board empty so the student places it.
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
          <div className="display-controls">
            <button className={`run-btn ${mode === 'practice' ? 'active' : ''}`} onClick={() => { setMode('practice'); setRevealed(false) }}>Practice</button>
            <button className={`run-btn ${mode === 'bench' ? 'active' : ''}`} onClick={() => { setMode('bench'); setRevealed(false); setHoverNet(null) }}>Bench</button>
            <button className="run-btn active" onClick={runCheck}>✓ Check</button>
            <button className="run-btn" onClick={saveLab}>Save</button>
            <button className="run-btn" onClick={() => fileRef.current?.click()}>Open</button>
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={openLab} />
          </div>
        </div>
        <div className="plotly-display" style={{ overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 8 }}>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ maxWidth: '100%', height: 'auto' }}>
            <rect x={2} y={2} width={W - 4} height={H - 4} rx={8} fill="#15171a" stroke="#333" />
            {[0, 1, 15, 16].map((s) => (
              <line key={s} x1={PAD - 10} y1={railY(s)} x2={W - PAD + 10} y2={railY(s)}
                stroke={s === 0 || s === 15 ? '#e04040' : '#4a9eff'} strokeOpacity={0.3} strokeWidth={2} />
            ))}
            <rect x={2} y={railY(CHANNEL_SLOT) - PITCH / 2} width={W - 4} height={PITCH} fill="#0d0d0d" />
            {holes.map((h) => {
              const net = nets.get(h.key)!
              const aCol = showNets ? activeColor.get(net) : undefined
              const hover = mode === 'practice' && hoverNet === net
              const base = h.kind === 'railP' ? '#5a2a2a' : h.kind === 'railN' ? '#23304a' : '#2b2b2b'
              const fill = hover ? '#ffffff' : (aCol ?? base)
              const r = (hover || pending === h.key) ? 4.4 : (aCol ? 3.6 : 3)
              return (
                <circle key={h.key} cx={h.x} cy={h.y} r={r} fill={fill}
                  stroke={pending === h.key ? '#fff' : '#000'} strokeWidth={pending === h.key ? 1.5 : 0.5}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => { if (mode === 'practice') setHoverNet(net) }}
                  onMouseLeave={() => setHoverNet(null)}
                  onClick={() => onHole(h.key)} />
              )
            })}
            {board.jumpers.map((j, i) => {
              const a = pos(j.a), b = pos(j.b)
              const jnet = nets.get(j.a)
              const col = (showNets && jnet && activeColor.get(jnet)) || '#c9cdd2'
              return (
                <g key={'j' + i} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default' }}
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
                <g key={p.id} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default' }}
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
                <g key={d.id} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default' }}
                  onClick={() => { if (tool.kind === 'select') { setBoard((bb) => ({ ...bb, dips: (bb.dips ?? []).filter((x) => x.id !== d.id) })); setCheck(null) } }}>
                  <rect x={bx} y={by} width={bw} height={bh} rx={3} fill="#1b1b1f" stroke="#888" strokeWidth={1} />
                  {/* notch on the left edge marks pin-1 end (datasheet orientation) */}
                  <path d={`M ${bx + 5} ${by + bh / 2 - 5} a 5 5 0 0 0 0 10`} fill="none" stroke="#888" strokeWidth={1} />
                  {pins.map((k, i) => {
                    const h = pos(k); const net = nets.get(k)!
                    const col = (showNets && activeColor.get(net)) || '#cfcfcf'
                    return <circle key={i} cx={h.x} cy={h.y} r={3.2} fill={col} stroke="#000" strokeWidth={0.5} />
                  })}
                  <text x={(bx + bx + bw) / 2} y={by + bh / 2 + 3} fontSize={8} fill="#cfcfcf" textAnchor="middle">{d.id} · LMC662</text>
                </g>
              )
            })}
            {board.ports.map((p) => {
              const h = pos(p.hole)
              return (
                <g key={p.port} style={{ cursor: tool.kind === 'select' ? 'pointer' : 'default' }}
                  onClick={() => { if (tool.kind === 'select') { setBoard((bb) => ({ ...bb, ports: bb.ports.filter((x) => x.port !== p.port) })); setCheck(null) } }}>
                  <circle cx={h.x} cy={h.y} r={5} fill="none" stroke="#e0c020" strokeWidth={1.5} />
                  <text x={h.x} y={h.y - 8} fontSize={8} fill="#e0c020" textAnchor="middle">{p.port}</text>
                </g>
              )
            })}
          </svg>
        </div>
        {check && (
          <div className="marker-table">
            <div className="marker-row">
              <span style={{ fontSize: 12, color: check.ok ? 'var(--theory-color)' : '#ffaa55' }}>{check.message}</span>
            </div>
          </div>
        )}
      </div>

      <div className="settings-panel">
        <div className="section-title">Place from schematic</div>
        {exp.parts.length === 0 && exp.dips.length === 0 && exp.ports.length === 0 ? (
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
            {exp.ports.map((p) => (
              <button key={p.name} style={chip(placedPort.has(p.name), tool.kind === 'placePort' && tool.port === p.name)}
                onClick={() => { setTool({ kind: 'placePort', port: p.name }); setPending(null); setCheck(null) }}>
                {placedPort.has(p.name) ? '✓ ' : ''}{p.name}
              </button>
            ))}
          </div>
        )}

        <div className="section-title">Tools</div>
        <div className="wave-selector">
          <button className={tool.kind === 'select' ? 'active' : ''} onClick={() => { setTool({ kind: 'select' }); setPending(null) }}>Select</button>
          <button className={tool.kind === 'jumper' ? 'active' : ''} onClick={() => { setTool({ kind: 'jumper' }); setPending(null) }}>Jumper</button>
          <button onClick={() => { setBoard({ parts: [], jumpers: [], ports: [], dips: [] }); setCheck(null); setPending(null) }}>Clear</button>
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.6 }}>
          {tool.kind === 'placePart' ? `Placing ${tool.id}: click two holes for its legs.`
            : tool.kind === 'placeDip' ? `Placing ${tool.id}: click a hole in row ${DIP_TOP_ROW} (top-left pin); the chip drops across the channel.`
            : tool.kind === 'placePort' ? `Placing ${tool.port}: click a hole (a rail, for power/ground).`
            : tool.kind === 'jumper' ? 'Jumper: click two holes to wire them together.'
            : 'Select: click a placed part, port, or jumper to remove it.'}
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
