// Pure unit/format + tune-slider helpers shared by the schematic editor and the
// instruments (no React). Single source of truth for component units and the LOOP-2
// live-tune ranges so the editor's slider and the Network Analyzer's knobs agree.
import type { SchKind } from './schematic'

export const UNIT: Partial<Record<SchKind, string>> = {
  resistor: 'Ω', capacitor: 'F', inductor: 'H', dcrail: 'V',
  led: 'V', zener: 'V', // led = forward voltage Vf; zener = breakdown voltage BV
  photodiode: 'A', // photocurrent (illumination): 80 nA/lx, so 1000 lx ≈ 80 µA
}

// Log range per filter component so dragging a tune slider spans decades smoothly.
export const TUNE_RANGE: Partial<Record<SchKind, [number, number]>> = {
  resistor: [1, 1e6],
  capacitor: [1e-12, 1e-5],
  inductor: [1e-6, 1],
  photodiode: [1e-9, 1e-3], // dark (≈nA) → bright sun (≈mA); drag illumination live
}

// Parse engineering notation like "1k", "159n", "4.7u" → number.
export function parseEng(s: string): number | undefined {
  const m = /^\s*(-?[\d.]+)\s*([pnumµkMG]?)\s*$/.exec(s)
  if (!m) return undefined
  const mult: Record<string, number> = {
    p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, '': 1, k: 1e3, M: 1e6, G: 1e9,
  }
  return parseFloat(m[1]) * mult[m[2]]
}

// Format a number in engineering notation (e.g. 1000 → "1k", 1e-7 → "100n").
export function fmtEng(x: number): string {
  if (x === 0) return '0'
  const units = [['G', 1e9], ['M', 1e6], ['k', 1e3], ['', 1], ['m', 1e-3], ['u', 1e-6], ['n', 1e-9], ['p', 1e-12]] as const
  for (const [suf, mul] of units) if (Math.abs(x) >= mul) return `${+(x / mul).toFixed(3)}${suf}`
  return String(x)
}

// Log-slider position (0..1000) ↔ value over a [lo, hi] range. Used by both the editor
// slider and the Network Analyzer tune knobs so they map identically.
export const TUNE_STEPS = 1000

export function tunePos(value: number, lo: number, hi: number): number {
  return Math.max(0, Math.min(TUNE_STEPS, Math.round((TUNE_STEPS * Math.log(value / lo)) / Math.log(hi / lo))))
}

export function tuneValue(pos: number, lo: number, hi: number): number {
  return lo * Math.pow(hi / lo, pos / TUNE_STEPS)
}
