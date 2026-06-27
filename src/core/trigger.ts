// Oscilloscope trigger engine (OSC-3). Pure logic, no React. See docs/specs/oscilloscope.md.
//
// A trigger stabilises the display: the trace is aligned so the chosen edge crosses the
// trigger level at a fixed horizontal position. Modes: Auto (free-run if no trigger), Normal
// (only redraw on a valid trigger), Single (capture one frame, then hold until re-armed).

export type Slope = 'rising' | 'falling'
export type TriggerMode = 'auto' | 'normal' | 'single'

// First sample index (sub-sample, linear-interpolated) at/after `startIndex` where `v` crosses
// `level` with the given slope. Returns null if there is no such crossing.
export function findEdgeTrigger(
  v: ArrayLike<number>, level: number, slope: Slope, startIndex = 0,
): number | null {
  const start = Math.max(1, Math.floor(startIndex))
  for (let i = start; i < v.length; i++) {
    const a = v[i - 1], b = v[i]
    const cross = slope === 'rising' ? (a < level && b >= level) : (a > level && b <= level)
    if (cross) {
      const frac = b !== a ? (level - a) / (b - a) : 0
      return (i - 1) + frac
    }
  }
  return null
}

// All sub-sample rising/falling crossings at/after `startIndex` (OSC-4 — used for the
// holdoff demo and the trigger count). Same interpolation as findEdgeTrigger.
export function findEdgeTriggers(
  v: ArrayLike<number>, level: number, slope: Slope, startIndex = 0,
): number[] {
  const out: number[] = []
  const start = Math.max(1, Math.floor(startIndex))
  for (let i = start; i < v.length; i++) {
    const a = v[i - 1], b = v[i]
    const cross = slope === 'rising' ? (a < level && b >= level) : (a > level && b <= level)
    if (cross) out.push((i - 1) + (b !== a ? (level - a) / (b - a) : 0))
  }
  return out
}

// Holdoff: after a trigger, ignore further triggers for `holdoffSamples`. Returns the accepted
// subset of `triggers` (assumed ascending) — the first, then any that are ≥ holdoff after the
// last accepted one. This is the machine-checkable form of "holdoff suppresses extra triggers".
export function applyHoldoff(triggers: number[], holdoffSamples: number): number[] {
  const out: number[] = []
  let last = -Infinity
  for (const t of triggers) {
    if (t - last >= holdoffSamples) { out.push(t); last = t }
  }
  return out
}

export type PulsePolarity = 'pos' | 'neg'
export type WidthMode = 'lessThan' | 'greaterThan'

// Pulse/width trigger (OSC-4). A pulse is a run above `level` (positive polarity) or below it
// (negative). Returns the sub-sample start index of the first pulse whose width (in samples)
// satisfies the comparison against `widthSamples`, or null. Pulses not closed within the buffer
// are ignored. The returned index is the level crossing that begins the qualifying pulse.
export function findPulseTrigger(
  v: ArrayLike<number>, level: number, polarity: PulsePolarity,
  widthMode: WidthMode, widthSamples: number, startIndex = 0,
): number | null {
  const n = v.length
  const inside = (x: number) => (polarity === 'pos' ? x >= level : x <= level)
  let i = Math.max(1, Math.floor(startIndex))
  while (i < n) {
    if (inside(v[i]) && !inside(v[i - 1])) {
      const sf = v[i] !== v[i - 1] ? (level - v[i - 1]) / (v[i] - v[i - 1]) : 0
      const startX = (i - 1) + sf
      let j = i + 1
      while (j < n && inside(v[j])) j++
      if (j >= n) return null // pulse runs off the end of the buffer
      const ef = v[j] !== v[j - 1] ? (level - v[j - 1]) / (v[j] - v[j - 1]) : 0
      const endX = (j - 1) + ef
      const width = endX - startX
      const ok = widthMode === 'lessThan' ? width < widthSamples : width > widthSamples
      if (ok) return startX
      i = j + 1
    } else {
      i++
    }
  }
  return null
}

// Mode state machine. `armed` matters only for single-shot (waiting to capture one frame).
export interface TriggerState { armed: boolean }
export type TriggerShow = 'triggered' | 'free' | 'hold'
export interface TriggerDecision { show: TriggerShow; state: TriggerState; status: string }

// Decide what to display this frame given whether a trigger was found, the mode, and the prior
// state. 'triggered' = align to the edge; 'free' = free-running (scrolling) frame; 'hold' = keep
// the previous frame.
export function nextTriggerState(prev: TriggerState, found: boolean, mode: TriggerMode): TriggerDecision {
  if (mode === 'auto') {
    return found
      ? { show: 'triggered', state: prev, status: "Trig'd" }
      : { show: 'free', state: prev, status: 'Auto' }
  }
  if (mode === 'normal') {
    return found
      ? { show: 'triggered', state: prev, status: "Trig'd" }
      : { show: 'hold', state: prev, status: 'Ready' }
  }
  // single
  if (!prev.armed) return { show: 'hold', state: prev, status: 'Stop' }
  return found
    ? { show: 'triggered', state: { armed: false }, status: 'Single' }
    : { show: 'hold', state: prev, status: 'Ready' }
}
