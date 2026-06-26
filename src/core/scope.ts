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
