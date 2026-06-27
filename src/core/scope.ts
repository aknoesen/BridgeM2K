// Oscilloscope core — channel bus types + sample resolution. No React.
// See docs/specs/oscilloscope.md (phase ARCH-1) and docs/CONVENTIONS.md §4.
//
// The channel bus generalises App from a single `signal` to named channels (CH1/CH2)
// whose data comes from a `ChannelSource`. This is the seam the circuit loop later plugs
// into: CH2's source flips from `generator2` to `circuit-out` without the Oscilloscope
// component changing.

import { SignalParams, generateSignal } from './signal'

export type ChannelId = 'CH1' | 'CH2'

export type ChannelSource =
  | { kind: 'generator' }    // primary Signal Generator output
  | { kind: 'generator2' }   // second independent generator (standalone two-channel)
  | { kind: 'circuit-out' }  // SPICE circuit output node — wired in LOOP-1

export interface ScopeChannel {
  id: ChannelId
  enabled: boolean
  source: ChannelSource
}

export type Samples = { t: Float64Array; x: Float64Array }

// Default bus: CH1 shows the generator (matches today's single-signal behaviour),
// CH2 is a second generator, disabled until the Oscilloscope panel (OSC-2) exposes it.
export const DEFAULT_CHANNELS: Record<ChannelId, ScopeChannel> = {
  CH1: { id: 'CH1', enabled: true,  source: { kind: 'generator' } },
  CH2: { id: 'CH2', enabled: false, source: { kind: 'generator2' } },
}

// Data sources available to drive channels. `circuitOut` stays null until the circuit
// loop exists (LOOP-1).
export interface ChannelInputs {
  generatorParams: SignalParams
  generator2Params: SignalParams
  circuitOut: Samples | null
}

// Resolve one channel's samples from its source. Returns null when no data is available
// (channel disabled, or a source not yet wired — e.g. circuit-out before LOOP-1).
export function resolveChannelSamples(
  channel: ScopeChannel,
  inputs: ChannelInputs,
): Samples | null {
  if (!channel.enabled) return null
  switch (channel.source.kind) {
    case 'generator':
      return generateSignal(inputs.generatorParams)
    case 'generator2':
      return generateSignal(inputs.generator2Params)
    case 'circuit-out':
      return inputs.circuitOut
  }
}

// ── Oscilloscope display helpers (OSC-1) ───────────────────────────────────────
// Pure geometry: slice the captured samples to a horizontal window and map volts→grid.
// 10 horizontal divisions × 8 vertical divisions, matching a Scopy-style graticule.

export const SCOPE_H_DIVS = 10
export const SCOPE_V_DIVS = 8

export interface ScopeTrace {
  t: number[] // seconds from window start
  v: number[] // volts
}

// Slice samples to the horizontal window (nDivs * timePerDiv seconds) starting at
// offsetSec, downsampled to <= maxPoints for display. If the window exceeds the available
// capture, returns what is available (the caller should keep timePerDiv within range).
export function captureWindow(
  samples: Samples,
  Fs: number,
  timePerDiv: number,
  offsetSec = 0,
  nDivs: number = SCOPE_H_DIVS,
  maxPoints = 2000,
): ScopeTrace {
  const windowSec = nDivs * timePerDiv
  const n = samples.x.length
  const start = Math.max(0, Math.min(n - 1, Math.round(offsetSec * Fs)))
  const count = Math.max(0, Math.min(n - start, Math.round(windowSec * Fs)))
  const stride = Math.max(1, Math.ceil(count / maxPoints))
  const t: number[] = []
  const v: number[] = []
  for (let i = 0; i < count; i += stride) {
    t.push(i / Fs)
    v.push(samples.x[start + i])
  }
  return { t, v }
}

// Fixed vertical range for a channel: ±(V_DIVS/2)·voltsPerDiv. The trace is plotted with
// the vertical offset added, so offset shifts the trace within this fixed graticule.
export function voltsAxisRange(
  voltsPerDiv: number,
  vDivs: number = SCOPE_V_DIVS,
): [number, number] {
  const half = (vDivs / 2) * voltsPerDiv
  return [-half, half]
}

// ── Measurements (OSC-5) ───────────────────────────────────────────────────────
// Quantities read off the captured window, Scopy-style. Amplitude stats are exact;
// timing (freq/period/duty) comes from interpolated mid-level crossings, the same
// sub-sample technique the trigger uses, so values match what a student computes by
// hand. Timing fields are null when the window holds no full cycle (e.g. a DC/flat
// trace) rather than reporting a bogus frequency.

export interface ScopeMeasurements {
  vpp: number
  vmax: number
  vmin: number
  mean: number
  vrms: number
  freq: number | null
  period: number | null
  duty: number | null // fraction 0..1 (time above mid-level / period)
}

// Linear-interpolated time (seconds) of the mid-level crossing between samples i-1 and i.
function crossTime(v: ArrayLike<number>, i: number, mid: number, dt: number): number {
  const a = v[i - 1]
  const b = v[i]
  const frac = (mid - a) / (b - a)
  return (i - 1 + frac) * dt
}

// Measure a uniformly-sampled voltage trace. `dt` is the sample spacing in seconds.
export function measureTrace(v: ArrayLike<number>, dt: number): ScopeMeasurements {
  const n = v.length
  if (n === 0) {
    return { vpp: 0, vmax: 0, vmin: 0, mean: 0, vrms: 0, freq: null, period: null, duty: null }
  }
  let vmax = -Infinity
  let vmin = Infinity
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const x = v[i]
    if (x > vmax) vmax = x
    if (x < vmin) vmin = x
    sum += x
    sumSq += x * x
  }
  const mean = sum / n
  const vrms = Math.sqrt(sumSq / n)
  const vpp = vmax - vmin

  // Timing from mid-level crossings. A tiny amplitude (flat/DC) has no real crossings.
  const mid = (vmax + vmin) / 2
  let period: number | null = null
  let freq: number | null = null
  let duty: number | null = null
  if (vpp > 1e-9) {
    const rising: number[] = []
    const falling: number[] = []
    for (let i = 1; i < n; i++) {
      if (v[i - 1] < mid && v[i] >= mid) rising.push(crossTime(v, i, mid, dt))
      else if (v[i - 1] >= mid && v[i] < mid) falling.push(crossTime(v, i, mid, dt))
    }
    if (rising.length >= 2) {
      // Average spacing between consecutive rising crossings → robust period estimate.
      let span = 0
      for (let k = 1; k < rising.length; k++) span += rising[k] - rising[k - 1]
      period = span / (rising.length - 1)
      freq = period > 0 ? 1 / period : null
      // Duty: high-time over one full period, anchored on the first rising crossing.
      const r0 = rising[0]
      const fall = falling.find((t) => t > r0)
      const r1 = rising[1]
      if (fall !== undefined && r1 > r0) duty = (fall - r0) / (r1 - r0)
    }
  }
  return { vpp, vmax, vmin, mean, vrms, freq, period, duty }
}
