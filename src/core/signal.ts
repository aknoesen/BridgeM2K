// Core signal generation, FFT, quantization — JavaScript port of SignalLab.m

export type WaveType = 'sine' | 'square' | 'triangle' | 'sawtooth'

export interface SignalParams {
  waveType: WaveType
  frequency: number    // Hz
  amplitude: number    // V peak
  offset: number       // V DC offset
  dutyCycle: number    // % (0–100), square only
  samplingRate: number // Sa/s
  duration: number     // s
}

// Snap duration to a whole number of periods to avoid spectral leakage. Exported (SIG-1) so the
// Spectrum readout and tests can compute N — the exact FFT length — identically to generateSignal.
// This is plumbing, NOT the protected leakage math: N lands every component on an integer bin only
// when numPeriods·Fs/f is an integer (i.e. Fs/f is a ratio whose denominator divides numPeriods).
export function snapDuration(duration: number, frequency: number, samplingRate: number) {
  const numPeriods = Math.max(1, Math.round(duration * frequency))
  return Math.round(numPeriods * samplingRate / frequency)
}

export function generateSignal(p: SignalParams): { t: Float64Array; x: Float64Array } {
  const N = snapDuration(p.duration, p.frequency, p.samplingRate)
  const t = new Float64Array(N)
  const x = new Float64Array(N)

  for (let i = 0; i < N; i++) {
    t[i] = i / p.samplingRate
    // Rational tau avoids 2π accumulation errors at transition boundaries
    const tau = ((i * p.frequency) / p.samplingRate) % 1

    switch (p.waveType) {
      case 'sine':
        x[i] = p.amplitude * Math.sin(2 * Math.PI * tau)
        break
      case 'square':
        x[i] = p.amplitude * (tau < p.dutyCycle / 100 ? 1 : -1)
        break
      case 'triangle':
        x[i] = p.amplitude * (1 - 4 * Math.abs(tau - 0.5))
        break
      case 'sawtooth':
        x[i] = p.amplitude * (2 * tau - 1)
        break
    }
    x[i] += p.offset
  }
  return { t, x }
}

// ── Cooley-Tukey FFT (power-of-2 length, in-place) ───────────────────────

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

function fft(re: Float64Array, im: Float64Array): void {
  const N = re.length
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]]
    }
  }
  // Butterfly passes
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j]
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe
        re[i + j] = uRe + vRe
        im[i + j] = uIm + vIm
        re[i + j + len / 2] = uRe - vRe
        im[i + j + len / 2] = uIm - vIm
        const newCurRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = newCurRe
      }
    }
  }
}

// ── Bluestein chirp-Z FFT (arbitrary N) ──────────────────────────────────
//
// Computes the N-point DFT without zero-padding.  When N is not a power of 2
// a padded power-of-2 convolution of length M >= 2N-1 is used internally.
//
// Why this matters: zero-padding to nextPow2(N) places harmonic peaks at
// non-integer bins (e.g. 1 kHz → bin 26.2 in a 4096-pt FFT at 100 kSa/s),
// producing Hanning sidelobes at −30 to −50 dBFS between harmonics that
// swamp the quantization noise floor for 8-bit and 12-bit ADCs.
// With an N-point FFT the periodically-sampled harmonics land on exact bins,
// giving near-zero inter-harmonic leakage so bit-depth differences are visible.
//
// The chirp kernel FFT is cached per N so repeated calls at the same N
// (10 fps × many seconds) skip the most expensive precomputation step.

interface BluesteinCache {
  M: number
  chirpRe: Float64Array   // time-domain chirp real (padded to M)
  chirpIm: Float64Array   // time-domain chirp imag (padded to M)
  chirpFftRe: Float64Array
  chirpFftIm: Float64Array
}
const bluesteinCache = new Map<number, BluesteinCache>()

function getBluesteinCache(N: number): BluesteinCache {
  const cached = bluesteinCache.get(N)
  if (cached) return cached

  const M = nextPow2(2 * N - 1)
  const chirpRe = new Float64Array(M)
  const chirpIm = new Float64Array(M)
  for (let n = 0; n < N; n++) {
    const angle = Math.PI * n * n / N
    chirpRe[n] = Math.cos(angle)
    chirpIm[n] = Math.sin(angle)
    if (n > 0) {
      chirpRe[M - n] = chirpRe[n]
      chirpIm[M - n] = chirpIm[n]
    }
  }
  // Pre-compute and cache FFT of chirp kernel
  const chirpFftRe = new Float64Array(chirpRe)
  const chirpFftIm = new Float64Array(chirpIm)
  fft(chirpFftRe, chirpFftIm)

  const entry: BluesteinCache = { M, chirpRe, chirpIm, chirpFftRe, chirpFftIm }
  bluesteinCache.set(N, entry)
  return entry
}

function bluesteinFFT(xRe: Float64Array, xIm: Float64Array): { re: Float64Array; im: Float64Array } {
  const N = xRe.length

  // Fast path: N already a power of 2
  if ((N & (N - 1)) === 0) {
    const re = new Float64Array(xRe)
    const im = new Float64Array(xIm)
    fft(re, im)
    return { re, im }
  }

  const { M, chirpRe, chirpIm, chirpFftRe, chirpFftIm } = getBluesteinCache(N)

  // a[n] = x[n] × conj(chirp[n])  (zero-padded to length M)
  const aRe = new Float64Array(M)
  const aIm = new Float64Array(M)
  for (let n = 0; n < N; n++) {
    aRe[n] =  xRe[n] * chirpRe[n] + xIm[n] * chirpIm[n]
    aIm[n] =  xIm[n] * chirpRe[n] - xRe[n] * chirpIm[n]
  }

  // Linear convolution via circular: conv = IFFT( FFT(a) × FFT(chirp) )
  // (FFT(chirp) is pre-computed in the cache)
  fft(aRe, aIm)

  for (let k = 0; k < M; k++) {
    const r = aRe[k] * chirpFftRe[k] - aIm[k] * chirpFftIm[k]
    const i = aRe[k] * chirpFftIm[k] + aIm[k] * chirpFftRe[k]
    aRe[k] = r
    aIm[k] = i
  }

  // IFFT via: ifft(x) = conj( fft( conj(x) ) ) / M
  for (let k = 0; k < M; k++) aIm[k] = -aIm[k]
  fft(aRe, aIm)
  for (let k = 0; k < M; k++) {
    aRe[k] /=  M
    aIm[k] = -aIm[k] / M
  }

  // X[k] = conj(chirp[k]) × conv[k]   for k = 0 … N-1
  const outRe = new Float64Array(N)
  const outIm = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    outRe[k] = aRe[k] * chirpRe[k] + aIm[k] * chirpIm[k]
    outIm[k] = aIm[k] * chirpRe[k] - aRe[k] * chirpIm[k]
  }
  return { re: outRe, im: outIm }
}

// ── Gaussian random (Box-Muller) ─────────────────────────────────────────────

function gaussianRandom(): number {
  let u: number, v: number, s: number
  do {
    u = Math.random() * 2 - 1
    v = Math.random() * 2 - 1
    s = u * u + v * v
  } while (s >= 1 || s === 0)
  return u * Math.sqrt(-2 * Math.log(s) / s)
}

// ── Window functions ──────────────────────────────────────────────────────────

export type WindowType = 'hanning' | 'hamming' | 'blackman' | 'flat-top' | 'rectangle'

function buildWindow(N: number, type: WindowType): { coeffs: Float64Array; sum: number } {
  const coeffs = new Float64Array(N)
  let sum = 0
  for (let i = 0; i < N; i++) {
    // Periodic form (denominator N, not N-1): makes the window exactly commensurate
    // with the DFT period so its DFT is the 3-tap kernel [N/4, N/2, N/4] with
    // exactly zero at all other bins.  Required for zero inter-harmonic leakage
    // when the signal is periodic in exactly N samples (as snapDuration guarantees).
    const t = 2 * Math.PI * i / N
    let w: number
    switch (type) {
      case 'hanning':   w = 0.5 * (1 - Math.cos(t));                                    break
      case 'hamming':   w = 0.54 - 0.46 * Math.cos(t);                                  break
      case 'blackman':  w = 0.42 - 0.5 * Math.cos(t) + 0.08 * Math.cos(2 * t);         break
      case 'flat-top':  w = 0.2156 - 0.4160 * Math.cos(t) + 0.2781 * Math.cos(2 * t)
                           - 0.0836 * Math.cos(3 * t) + 0.0069 * Math.cos(4 * t);       break
      default:          w = 1;                                                             break
    }
    coeffs[i] = w
    sum += w
  }
  return { coeffs, sum }
}

export interface SpectrumResult {
  freqAxis: Float64Array
  magnitudeDbfs: Float64Array   // dBFS re ADC full-scale peak
  noiseFloorDbfs: number        // per-bin noise density (what's visible in the plot)
  snrDb: number                 // total SNR (Walden formula, for label display)
  binWidthHz: number            // frequency resolution of each FFT bin
}

export function computeSpectrum(
  x: Float64Array,
  samplingRate: number,
  bits: number = 12,
  adcRangeV: number = 5,        // total range (default ±2.5 V = 5 V)
  windowType: WindowType = 'hanning'
): SpectrumResult {
  const N = x.length

  // Remove DC
  let mean = 0
  for (let i = 0; i < N; i++) mean += x[i]
  mean /= N

  const lsb = adcRangeV / Math.pow(2, bits)
  const halfRange = adcRangeV / 2

  const { coeffs: win, sum: winSum } = buildWindow(N, windowType)

  // Window the ideal (unquantized) signal
  const xRe = new Float64Array(N)
  const xIm = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    xRe[i] = (x[i] - mean) * win[i]
  }

  // N-point FFT of ideal signal (Bluestein for non-power-of-2 N)
  const { re, im } = bluesteinFFT(xRe, xIm)

  // Synthetic quantization noise: complex Gaussian at each bin with
  // σ² = winPowerSum × lsb²/8 per component (calibrated to TPDF variance).
  // Fresh realization each call → noise shimmers like a real instrument.
  const noiseBW = windowType === 'rectangle' ? 1.00
                : windowType === 'hamming'   ? 1.36
                : windowType === 'blackman'  ? 1.73
                : windowType === 'flat-top'  ? 3.77
                : 1.50
  const winPowerSum = noiseBW * winSum * winSum / N
  const sigBin = lsb * Math.sqrt(winPowerSum / 8)
  const nUniq = Math.floor(N / 2) + 1
  for (let i = 0; i < nUniq; i++) {
    re[i] += gaussianRandom() * sigBin
    im[i] += gaussianRandom() * sigBin
  }

  const freqAxis = new Float64Array(nUniq)
  const magnitudeDbfs = new Float64Array(nUniq)

  // dBFS reference: ADC full-scale peak (0 dBFS = signal at ±halfRange)
  const fullScalePeak = halfRange

  for (let i = 0; i < nUniq; i++) {
    freqAxis[i] = i * samplingRate / N
    // Normalise by window sum (amplitude-corrected single-sided spectrum)
    let mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / winSum
    if (i > 0 && i < nUniq - 1) mag *= 2
    magnitudeDbfs[i] = 20 * Math.log10((mag + 1e-12) / fullScalePeak)
  }

  // Total SNR from Walden formula
  const snrDb = 6.02 * bits + 1.76

  const noiseFloorDbfs = -10 * Math.log10(N) - bits * 6.021
                         + 10 * Math.log10(2 * noiseBW / 3)

  const binWidthHz = samplingRate / N  // N-point FFT: exact bin width, no zero-padding

  return { freqAxis, magnitudeDbfs, noiseFloorDbfs, snrDb, binWidthHz }
}

// Theoretical Fourier harmonic amplitudes for comparison overlay
export interface HarmonicPrediction {
  frequencies: number[]
  amplitudesV: number[]  // peak amplitude in volts
}

export function theoreticalHarmonics(
  waveType: WaveType,
  amplitude: number,
  frequency: number,
  dutyCycle: number,
  numHarmonics: number = 9
): HarmonicPrediction {
  const frequencies: number[] = []
  const amplitudesV: number[] = []

  for (let n = 1; n <= numHarmonics; n++) {
    frequencies.push(n * frequency)
    let amp = 0

    switch (waveType) {
      case 'sine':
        amp = n === 1 ? amplitude : 0
        break
      case 'square': {
        // General duty cycle D: amplitude = (2A/nπ) × sin(nπD)
        const D = dutyCycle / 100
        amp = Math.abs((2 * amplitude / (n * Math.PI)) * Math.sin(n * Math.PI * D))
        break
      }
      case 'triangle':
        // Odd harmonics only: (8A/π²n²) × (−1)^((n−1)/2)
        amp = n % 2 === 1 ? (8 * amplitude / (Math.PI * Math.PI * n * n)) : 0
        break
      case 'sawtooth':
        // All harmonics: 2A/nπ
        amp = 2 * amplitude / (n * Math.PI)
        break
    }
    amplitudesV.push(amp)
  }
  return { frequencies, amplitudesV }
}
