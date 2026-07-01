// Transimpedance-amplifier compensation helper (TIA-3). Pure math, no React/engine.
//
// A photodiode TIA rolls off when the total input capacitance Cin (the photodiode junction CJO plus
// the op-amp input capacitance) forms a pole with the feedback resistor Rf inside the loop. That
// pole peaks the noise gain and can make the amplifier ring or oscillate. A small feedback capacitor
// Cf across Rf places a compensating zero; the textbook flat-response value is the geometric mean of
// the noise-gain pole and the closed-loop bandwidth:
//
//     Cf ≈ √( Cin / (2π · Rf · GBW) )
//
// which sets the closed-loop −3 dB bandwidth to f = 1/(2π·Rf·Cf) = √( GBW / (2π·Rf·Cin) ). If the
// actual Cf is absent or smaller than this, the response peaks (under-damped); larger is stable but
// trades away bandwidth. See docs/specs/tia-transimpedance.md.

export interface TiaCompensation {
  cinFarads: number
  rfOhms: number
  gbwHz: number
  cfRecommended: number // √(Cin/(2π·Rf·GBW)) — the flat-response feedback cap
  bandwidthHz: number   // closed-loop −3 dB bandwidth with the recommended Cf
  cfActual?: number     // the Cf actually in the circuit, if any
  peaking: boolean      // true when cfActual is absent or below cfRecommended → under-damped
}

// Compute the recommended Cf, the resulting bandwidth, and whether the present Cf (if any) is too
// small (peaking). Non-positive inputs return a zeroed result with peaking=true (nothing to trust).
export function tiaCompensation(cinFarads: number, rfOhms: number, gbwHz: number, cfActual?: number): TiaCompensation {
  if (!(cinFarads > 0) || !(rfOhms > 0) || !(gbwHz > 0)) {
    return { cinFarads, rfOhms, gbwHz, cfRecommended: 0, bandwidthHz: 0, cfActual, peaking: true }
  }
  const cfRecommended = Math.sqrt(cinFarads / (2 * Math.PI * rfOhms * gbwHz))
  const bandwidthHz = 1 / (2 * Math.PI * rfOhms * cfRecommended)
  const peaking = (cfActual ?? 0) < cfRecommended
  return { cinFarads, rfOhms, gbwHz, cfRecommended, bandwidthHz, cfActual, peaking }
}
