// Quickstart panel (Track H / QS-1) — onboarding for two audiences: first-time users of this app,
// and people meeting the real Analog Devices ADALM2000 (M2K) for the first time. It leads with how
// each app panel mirrors a real Scopy/M2K instrument (the app↔bench bridge), then walks a first
// measurement: a voltage divider on the Power Supply + Voltmeter. The step buttons drive the app —
// they load the matching example and jump to the right instrument so "load X, open Y, read Z" just
// works on the deterministic example library. Static content only; touches no core/ signal math.
import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import './Instrument.css'

// Remembered scroll offset of the guide. Module-level so it survives the panel unmounting when the
// user clicks a step to visit an instrument — on return we restore them to where they left off.
let lastScroll = 0

interface Props {
  // Switch the visible instrument panel (id is an App ActiveInstrument).
  onGoTo: (id: string) => void
  // Load a built-in example by id (sets the schematic + generator + scope presets).
  onLoadExample: (id: string) => void
}

const GOLD = '#FFBF00'
const link: CSSProperties = { color: 'var(--accent-blue)' }
const h3: CSSProperties = { color: '#2ee6ff', marginBottom: 6, marginTop: 28 }
const card: CSSProperties = { background: 'var(--bg-display)', border: '1px solid var(--border)', borderRadius: 6, padding: '14px 16px', marginTop: 12 }
const stepNum: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: GOLD, color: '#022851', fontWeight: 700, fontSize: 13, marginRight: 8, flex: '0 0 auto' }
const goBtn: CSSProperties = { padding: '7px 14px', fontSize: 13, fontWeight: 700, color: '#022851', background: GOLD, border: 'none', borderRadius: 6, cursor: 'pointer' }
const openBtn: CSSProperties = { padding: '3px 10px', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer' }

// real M2K signal/instrument  ↔  this app's panel
const BRIDGE: { real: string; panel: string; id: string }[] = [
  { real: 'Power supply — V+ / V− rails, 0..±5 V (DAC-driven)', panel: 'Supply', id: 'psu' },
  { real: 'Voltmeter — two 12-bit ADC channels (1±, 2±)', panel: 'Voltmeter', id: 'voltmeter' },
  { real: 'Function generator — W1 / W2 outputs (DAC)', panel: 'Signal Gen', id: 'siggen' },
  { real: 'Oscilloscope — voltage vs time', panel: 'Scope', id: 'scope' },
  { real: 'Spectrum analyzer — frequency content', panel: 'Spectrum', id: 'spectrum' },
  { real: 'Network analyzer — gain/phase vs frequency (Bode)', panel: 'Network', id: 'network' },
  { real: 'Solderless breadboard + circuit', panel: 'Circuit / Board', id: 'schematic' },
]

export default function Quickstart({ onGoTo, onLoadExample }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // Restore the remembered scroll position before paint (no flash of the top).
  useLayoutEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = lastScroll }, [])
  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header"><span className="display-title">Quickstart</span></div>
        <div ref={scrollRef} onScroll={(e) => { lastScroll = e.currentTarget.scrollTop }}
          style={{ padding: 24, overflow: 'auto', maxWidth: 860, lineHeight: 1.7, color: 'var(--text-primary)' }}>

          <h2 style={{ color: GOLD, margin: '0 0 4px' }}>Welcome to BridgeM2K</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
            New to this app, or new to the ADALM2000 (M2K) itself? Start here. BridgeM2K is a digital
            twin of the real M2K USB instrument: every panel here behaves like the matching instrument
            in Analog Devices' Scopy software, so what you do in the browser maps directly onto the
            bench hardware you will use in lab.
          </p>

          <h3 style={h3}>How the M2K and this app line up</h3>
          <p style={{ marginTop: 0 }}>
            The real M2K turns numbers into voltages (its <b>DAC</b> outputs: the power supplies and
            the W1/W2 generators) and voltages back into numbers (its 12-bit <b>ADC</b> inputs: the
            voltmeter and scope channels). Each of those is a panel in the sidebar:
          </p>
          <div style={card}>
            {BRIDGE.map((b) => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ flex: 1, fontSize: 13 }}>{b.real}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>→ {b.panel}</span>
                <button style={openBtn} onClick={() => onGoTo(b.id)}>Open</button>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 10 }}>
            <b style={{ color: GOLD }}>One thing the M2K trips people on:</b> W1 / W2 are <i>signal</i>
            outputs (≈ 50 Ω source resistance), not a power source — use the <b>V+ / V−</b> supply to
            power a circuit, and W1/W2 only to inject a signal. The twin models this 50 Ω, so a heavy
            load on W1/W2 sags here exactly as it would on the bench.
          </p>

          <h3 style={h3}>Single-ended vs differential — read this twice</h3>
          <p style={{ marginTop: 0 }}>
            Every voltmeter and scope channel has <b>two</b> inputs, a{' '}
            <b style={{ color: 'var(--ch1-color)' }}>+</b> and a <b style={{ color: '#40c0e0' }}>−</b>,
            and both <b>float</b>: neither is ground until you wire it that way. Where you put the −
            lead decides which of two very different measurements you get.
          </p>
          <div style={card}>
            <svg viewBox="0 0 760 252" style={{ width: '100%', height: 'auto' }} role="img"
              aria-label="Left: single-ended measurement with the minus lead tied to ground reads one node relative to zero volts. Right: differential measurement with plus and minus across two live nodes reads their difference.">
              <line x1="380" y1="14" x2="380" y2="238" stroke="var(--border)" strokeWidth="1" />

              {/* ── Single-ended ── */}
              <text x="24" y="28" fill="var(--text-primary)" fontSize="15" fontWeight="700">Single-ended</text>
              <text x="24" y="46" fill="var(--text-secondary)" fontSize="12">− lead tied to GROUND</text>
              <circle cx="70" cy="150" r="4" fill="var(--text-primary)" />
              <text x="18" y="176" fill="var(--text-primary)" fontSize="12">node = −5 V</text>
              <line x1="70" y1="150" x2="225" y2="150" stroke="var(--ch1-color)" strokeWidth="2.5" />
              <text x="140" y="142" fill="var(--ch1-color)" fontSize="12" fontWeight="700">1+</text>
              <circle cx="255" cy="150" r="30" fill="var(--bg-panel)" stroke="var(--text-secondary)" strokeWidth="2" />
              <text x="255" y="157" fill="var(--text-primary)" fontSize="18" fontWeight="700" textAnchor="middle">V</text>
              <line x1="255" y1="180" x2="255" y2="204" stroke="#40c0e0" strokeWidth="2.5" />
              <text x="264" y="197" fill="#40c0e0" fontSize="12" fontWeight="700">1−</text>
              <line x1="243" y1="206" x2="267" y2="206" stroke="var(--text-secondary)" strokeWidth="2" />
              <line x1="247" y1="211" x2="263" y2="211" stroke="var(--text-secondary)" strokeWidth="2" />
              <line x1="251" y1="216" x2="259" y2="216" stroke="var(--text-secondary)" strokeWidth="2" />
              <text x="298" y="156" fill="var(--ch1-color)" fontSize="15" fontWeight="700">= −5 V</text>
              <text x="24" y="234" fill="var(--text-secondary)" fontSize="11.5">One node measured against 0 V.</text>

              {/* ── Differential ── */}
              <text x="404" y="28" fill="var(--text-primary)" fontSize="15" fontWeight="700">Differential</text>
              <text x="404" y="46" fill="var(--text-secondary)" fontSize="12">+ and − across two live nodes</text>
              <circle cx="470" cy="112" r="4" fill="var(--text-primary)" />
              <text x="414" y="116" fill="var(--text-primary)" fontSize="12">+5 V</text>
              <circle cx="470" cy="182" r="4" fill="var(--text-primary)" />
              <text x="414" y="186" fill="var(--text-primary)" fontSize="12">−5 V</text>
              <line x1="470" y1="112" x2="626" y2="136" stroke="var(--ch1-color)" strokeWidth="2.5" />
              <line x1="470" y1="182" x2="626" y2="164" stroke="#40c0e0" strokeWidth="2.5" />
              <text x="545" y="120" fill="var(--ch1-color)" fontSize="12" fontWeight="700">1+</text>
              <text x="545" y="182" fill="#40c0e0" fontSize="12" fontWeight="700">1−</text>
              <circle cx="656" cy="150" r="30" fill="var(--bg-panel)" stroke="var(--text-secondary)" strokeWidth="2" />
              <text x="656" y="157" fill="var(--text-primary)" fontSize="18" fontWeight="700" textAnchor="middle">V</text>
              <text x="656" y="212" fill="#40c0e0" fontSize="15" fontWeight="700" textAnchor="middle">= +10 V</text>
              <text x="404" y="234" fill="var(--text-secondary)" fontSize="11.5">The difference: 5 − (−5) = 10 V. No ground needed.</text>
            </svg>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 10 }}>
            Same two probes, different wiring. Measuring the −5 V node against ground reads <b>−5 V</b>
            (single-ended); putting + on +5 V and − on −5 V reads the <b>10 V</b> span between them
            (differential) — a number no single-ended reading gives you. You choose which you get by
            where the <b>−</b> probe lands: on ground, or on another node. The diode I-V example uses a
            differential pair to read the voltage <i>across</i> the diode, which has neither end at ground.
          </p>
          <p style={{ fontSize: 12.5, color: '#ffbf00', marginTop: 8 }}>
            Always connect <b>both</b> inputs, on purpose. The − input is <b>not</b> internally grounded —
            leave it unconnected and the channel has no reference, so the reading is meaningless and just
            drifts on noise. Wire − explicitly every time: to <b>ground</b> for a single-ended reading, or
            to your <b>reference node</b> for a differential one.
          </p>

          <h3 id="draw-first-circuit" style={h3}>Draw your first circuit: the M2K supply rails</h3>
          <p style={{ marginTop: 0 }}>
            Now build one yourself instead of loading it. You'll draw the M2K's two supply rails and
            measure them on the Voltmeter — single-ended first, then differential. The wiring you do
            here is the same wiring you'll repeat on the real bench, so this is the part worth
            practising: placing parts and connecting them, not just pressing a button.
          </p>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>1</span>
              <div style={{ flex: 1 }}>
                <b>Open the Circuit editor.</b> You get an empty canvas. Along the top is a tool for
                each part you can place, plus <b>Select</b> (to pick up and move things) and <b>Wire</b>
                (to connect them).
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('schematic')}>Open Circuit editor →</button></div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>2</span>
              <div style={{ flex: 1 }}>
                <b>Place the supply ports.</b> Click the <b style={{ color: '#e04040' }}>V+</b> tool,
                then click the canvas to drop it. Do the same for <b style={{ color: '#4a9eff' }}>V−</b>
                and <b>GND</b>. These are the M2K's power-supply rails and its ground.
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>3</span>
              <div style={{ flex: 1 }}>
                <b>Place the four probe ports.</b> Drop <b style={{ color: 'var(--ch1-color)' }}>1+</b>,
                <b style={{ color: '#40c0e0' }}> 1−</b>, <b style={{ color: 'var(--ch1-color)' }}>2+</b>,
                <b style={{ color: '#40c0e0' }}> 2−</b> — each is one half of a voltmeter channel.
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>4</span>
              <div style={{ flex: 1 }}>
                <b>Wire it (single-ended).</b> Pick the <b>Wire</b> tool and connect{' '}
                <b style={{ color: 'var(--ch1-color)' }}>1+</b> → the <b style={{ color: '#e04040' }}>V+</b> node,
                <b style={{ color: '#40c0e0' }}> 1−</b> → <b>GND</b>,
                <b style={{ color: 'var(--ch1-color)' }}> 2+</b> → the <b style={{ color: '#4a9eff' }}>V−</b> node,
                and <b style={{ color: '#40c0e0' }}>2−</b> → <b>GND</b>. A <b>junction dot</b> appears at
                each connection — that's your confirmation the wire took.
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>5</span>
              <div style={{ flex: 1 }}>
                <b>Set the supply.</b> Open the Power Supply (independent mode) and set
                <b style={{ color: '#e04040' }}> V+</b> and <b style={{ color: '#4a9eff' }}>V−</b> to the
                values you want — say +5 V and −5 V.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('psu')}>Open Power Supply →</button></div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>6</span>
              <div style={{ flex: 1 }}>
                <b>Read it.</b> Open the Voltmeter and press Measure. <b>Channel 1</b> = V(1+) − V(1−) =
                V+; <b>Channel 2</b> = V−. Both are single-ended, because each <b>−</b> input sits on
                ground.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('voltmeter')}>Open Voltmeter →</button></div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>7</span>
              <div style={{ flex: 1 }}>
                <b>Make Channel 1 differential.</b> Move the <b style={{ color: '#40c0e0' }}>1−</b> input
                off ground and onto the <b style={{ color: '#4a9eff' }}>V−</b> node: with <b>Select</b>,
                click its wire to <b>GND</b> and delete it, then use <b>Wire</b> to connect
                <b style={{ color: '#40c0e0' }}> 1−</b> straight to <b style={{ color: '#4a9eff' }}>V−</b>.
                Measure again — Channel 1 now reads <b>V+ − V−</b> (the full ±span), while Channel 2 still
                reads V− alone. This is the identical lead move you'll make on the real M2K.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('schematic')}>Back to Circuit editor →</button></div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>8</span>
              <div style={{ flex: 1 }}>
                <b>Save it for your records.</b> In the Voltmeter, press <b>Export PNG</b> to save the
                readings (title and per-channel labels are included). Annotate your name on top, the same
                way you would a bench screenshot, and submit it.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('voltmeter')}>Open Voltmeter →</button></div>
              </div>
            </div>
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 12 }}>
            That's the whole loop: place parts, wire them, power them, measure, then change the wiring to
            change the measurement. Everything below loads ready-made circuits, but you now know how to
            build your own.
          </p>

          <h3 style={h3}>Your first measurement — a voltage divider</h3>
          <p style={{ marginTop: 0 }}>
            Pair the <b>Power Supply</b> with the <b>Voltmeter</b>: set a DC voltage, then read it. We
            will apply a voltage to two equal resistors and confirm the midpoint is exactly half.
          </p>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>1</span>
              <div style={{ flex: 1 }}>
                <b>Load the voltage divider.</b> Two 10 kΩ resistors in series from V+ to ground, with
                the midpoint tapped. This drops it onto the canvas for you.
                <div style={{ marginTop: 8 }}>
                  <button style={goBtn} onClick={() => { onLoadExample('divider'); onGoTo('schematic') }}>Load divider &amp; show circuit →</button>
                </div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>2</span>
              <div style={{ flex: 1 }}>
                <b>Set the supply.</b> Open the Power Supply — V+ is the applied voltage (it defaults to
                +5 V, the M2K's DAC-driven rail). On the real bench this is the red V+ wire.
                <div style={{ marginTop: 8 }}>
                  <button style={goBtn} onClick={() => onGoTo('psu')}>Open Power Supply →</button>
                </div>
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>3</span>
              <div style={{ flex: 1 }}>
                <b>Read it.</b> Open the Voltmeter and press Measure. <b>Channel 2</b> reads the applied
                V+ (≈ 5 V); <b>Channel 1</b> reads the midpoint (≈ 2.5 V) — exactly half, because the two
                resistors are equal. Change V+ on the Power Supply and watch both readings track.
                <div style={{ marginTop: 8 }}>
                  <button style={goBtn} onClick={() => onGoTo('voltmeter')}>Open Voltmeter →</button>
                </div>
              </div>
            </div>
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 12 }}>
            Both channels here are <i>single-ended</i> — each reads one node relative to ground, because
            its <b>−</b> input is wired to ground. Move a <b>−</b> input onto another node instead and that
            channel becomes <i>differential</i>, reading the voltage between the two points. Either way,
            wire the <b>−</b> input deliberately — never leave it floating.
          </p>

          <h3 style={h3}>Next: Signal Generator + Oscilloscope</h3>
          <p style={{ marginTop: 0 }}>
            The two <b>W</b> outputs are your signal sources; the Oscilloscope shows voltage <i>vs time</i>.
            Set a wave on W1, watch it on the scope — that is normal time-base (<b>YT</b>) mode, with
            Time/div setting the window and each channel its own Volts/div.
          </p>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>1</span>
              <div style={{ flex: 1 }}>
                <b>Set a signal.</b> Open the Signal Generator, pick a wave / frequency / amplitude on W1
                (W2 is the second source), and press Run.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('siggen')}>Open Signal Generator →</button></div>
              </div>
            </div>
          </div>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>2</span>
              <div style={{ flex: 1 }}>
                <b>See it in time.</b> Open the Oscilloscope — voltage vs time (YT). Time/div zooms the
                window; the trigger holds the wave steady.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('scope')}>Open Oscilloscope →</button></div>
              </div>
            </div>
          </div>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>3</span>
              <div style={{ flex: 1 }}>
                <b>Switch to XY — trace an I-V curve.</b> XY mode plots CH1 (X = voltage across the part)
                against CH2 (Y = its current), drawing the device's I-V curve directly. The <b>Zener</b> is
                the showcase: you see the forward turn-on (~0.7 V) <i>and</i> the reverse breakdown
                (~−3.3 V). This loads it straight into XY; use the scope's XY/YT toggle to switch back.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => { onLoadExample('zener-iv'); onGoTo('scope') }}>Load Zener I-V (XY) →</button></div>
              </div>
            </div>
          </div>

          <h3 style={h3}>Next: Network Analyzer — and how the M2K digitizes</h3>
          <p style={{ marginTop: 0 }}>
            The Network Analyzer sweeps frequency and plots gain (and phase) against it — a <b>Bode</b>
            plot. Load the RC low-pass and you will see it pass low frequencies and roll off above ~1 kHz
            (the −3 dB corner).
          </p>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>1</span>
              <div style={{ flex: 1 }}>
                <b>Sweep a filter.</b> Load the RC low-pass and open the Network Analyzer to see its Bode curve.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => { onLoadExample('rc-lp'); onGoTo('network') }}>Load RC low-pass → Network Analyzer →</button></div>
              </div>
            </div>
          </div>
          <p style={{ marginTop: 14 }}>
            Behind every reading is digitization: the M2K samples voltages with a <b>12-bit ADC</b>, and
            the Spectrum Analyzer shows levels in <b>dBFS</b> — decibels relative to <i>full scale</i>.
            <b> 0 dBFS</b> is the ADC's full-scale peak (here ±2.5 V). Rounding each sample to one of the
            ADC's steps adds a little noise, which sets a <i>floor</i> you cannot see below — and more bits
            push that floor down:
          </p>
          <div style={card}>
            <svg viewBox="0 0 760 244" style={{ width: '100%', height: 'auto' }} role="img"
              aria-label="dBFS scale: 0 dBFS is ADC full scale; the quantization noise floor sits near minus 104 dBFS at 12 bits, higher for fewer bits.">
              {/* axis + gridlines (0 to −120 dBFS) */}
              <text x="36" y="24" fill="var(--text-secondary)" fontSize="12">dBFS</text>
              {[0, -20, -40, -60, -80, -100, -120].map((db) => {
                const y = 34 + (-db) * 1.55
                return (
                  <g key={db}>
                    <line x1="150" y1={y} x2="720" y2={y} stroke="var(--border)" strokeWidth="1" />
                    <text x="142" y={y + 4} fill="var(--text-secondary)" fontSize="11" textAnchor="end">{db}</text>
                  </g>
                )
              })}
              {/* shaded unrecoverable region below the 12-bit floor */}
              <rect x="150" y={34 + 104 * 1.55} width="570" height={34 + 120 * 1.55 - (34 + 104 * 1.55)} fill="rgba(255,255,255,0.04)" />
              {/* 0 dBFS = full scale */}
              <line x1="150" y1="34" x2="720" y2="34" stroke="#ffbf00" strokeWidth="2.5" />
              <text x="156" y="28" fill="#ffbf00" fontSize="12" fontWeight="700">0 dBFS = ADC full scale (±2.5 V)</text>
              {/* a measured tone */}
              <line x1="300" y1={34 + 120 * 1.55} x2="300" y2={34 + 8 * 1.55} stroke="var(--ch1-color)" strokeWidth="3" />
              <circle cx="300" cy={34 + 8 * 1.55} r="4" fill="var(--ch1-color)" />
              <text x="310" y={34 + 8 * 1.55 + 4} fill="var(--ch1-color)" fontSize="12">a measured tone</text>
              {/* noise floors */}
              <line x1="150" y1={34 + 56 * 1.55} x2="720" y2={34 + 56 * 1.55} stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="6 4" />
              <text x="430" y={34 + 56 * 1.55 - 5} fill="var(--text-secondary)" fontSize="11.5">4-bit floor ≈ −56 dBFS</text>
              <line x1="150" y1={34 + 80 * 1.55} x2="720" y2={34 + 80 * 1.55} stroke="var(--text-secondary)" strokeWidth="1.5" strokeDasharray="6 4" />
              <text x="430" y={34 + 80 * 1.55 - 5} fill="var(--text-secondary)" fontSize="11.5">8-bit floor ≈ −80 dBFS</text>
              <line x1="150" y1={34 + 104 * 1.55} x2="720" y2={34 + 104 * 1.55} stroke="var(--theory-color)" strokeWidth="2.5" />
              <text x="410" y={34 + 104 * 1.55 - 5} fill="var(--theory-color)" fontSize="12" fontWeight="700">12-bit floor (this M2K) ≈ −104 dBFS</text>
            </svg>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 10 }}>
            The gap between your tone and the floor is the dynamic range you actually have. The Spectrum
            Analyzer's <b>Learning Mode</b> lets you drop the bit depth to 8 or 4 and watch the floor rise —
            the clearest way to feel what "12-bit" buys you.
            <span style={{ display: 'block', marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('spectrum')}>Open Spectrum Analyzer →</button></span>
          </p>

          <h3 style={h3}>Next: the Curve Tracer — a transistor's whole family of curves</h3>
          <p style={{ marginTop: 0 }}>
            A transistor isn't one number, it's a <i>family</i> of output curves. The Curve Tracer sweeps
            the drain/collector voltage and overlays one curve per gate/base step, so you read the device's
            character at a glance: a MOSFET's triode-to-saturation <b>I<sub>d</sub> vs V<sub>ds</sub></b> at
            each V<sub>gs</sub>, or a BJT's <b>I<sub>c</sub> vs V<sub>ce</sub></b> at each base step.
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 8 }}>
            Under the hood it's the real bench trick: <b>W1</b> ramps the drain/collector voltage, <b>W2</b>
            sets a constant gate/base bias, and a <b>sense resistor</b> turns current into a voltage the ADC
            can read (I = V<sub>sense</sub> / R<sub>sense</sub>). The real M2K traces one curve at a time; the
            twin automates the stepped passes and draws the whole labelled family in one shot. Tune the
            <b> sweep max</b>, <b>ramp</b>, and <b>step list</b> to spread or add curves.
          </p>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>1</span>
              <div style={{ flex: 1 }}>
                <b>Load the MOSFET family.</b> The <b>ZVN2110A</b> NMOS swept at five gate steps. This loads
                it and opens the Curve Tracer, where the family draws itself (auto-run).
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => { onLoadExample('nmos-curve-family'); onGoTo('curvetracer') }}>Load MOSFET curve family → Curve Tracer →</button></div>
              </div>
            </div>
          </div>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>2</span>
              <div style={{ flex: 1 }}>
                <b>Swap the device, retrace.</b> Load the <b>2N3904</b> NPN family and the same panel
                redraws as <b>I<sub>c</sub> vs V<sub>ce</sub></b>. That's the real payoff: change the
                transistor in any tracer circuit (W1 + W2 + sense resistor), retrace, and you immediately
                see how <i>that</i> part behaves.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => { onLoadExample('bjt-curve-family'); onGoTo('curvetracer') }}>Load BJT curve family → Curve Tracer →</button></div>
              </div>
            </div>
          </div>
          <p style={{ fontSize: 12.5, color: '#ffbf00', marginTop: 10 }}>
            Mind the example names: <b>"MOSFET curve family"</b> and <b>"BJT curve family"</b> drive the
            Curve Tracer. The <b>"(XY)"</b> examples — "MOSFET output curve (XY)", "Diode I-V", "Zener I-V"
            — are Oscilloscope XY-mode demos that draw a <i>single</i> curve the live bench way, not the
            tracer. Same sense-resistor idea, different view.
          </p>

          <h3 style={h3}>Next: from circuit &amp; simulation to the breadboard</h3>
          <p style={{ marginTop: 0 }}>
            Draw a circuit in the Circuit editor and the app simulates it (real ngspice), so every
            instrument measures <i>your</i> design. Once it works in simulation, move it to the Breadboard
            and press <b>Check</b> — the app verifies your physical layout is electrically the same as the
            schematic. Practice mode colours the nets live as you wire; Bench mode hides the hints, like
            the real bench.
          </p>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>1</span>
              <div style={{ flex: 1 }}>
                <b>Draw &amp; simulate.</b> Open the Circuit editor, build (or load an example), and the
                instruments read it live. Parts connect where their pins meet a wire or another pin —
                a small <b>dot</b> marks every connected node, so you can see what's joined. Tip: when
                two pins should connect, run a <b>wire</b> between them (drag a part and its wires
                follow); just touching also connects, and dragging the part later keeps that link.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('schematic')}>Open Circuit editor →</button></div>
              </div>
            </div>
          </div>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <span style={stepNum}>2</span>
              <div style={{ flex: 1 }}>
                <b>Transfer &amp; check.</b> Open the Breadboard, place the same parts, and press Check to
                confirm your layout matches the schematic before you build it for real.
                <div style={{ marginTop: 8 }}><button style={goBtn} onClick={() => onGoTo('breadboard')}>Open Breadboard →</button></div>
              </div>
            </div>
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 24 }}>
            More on the real instrument: the{' '}
            <a href="https://www.analog.com/en/resources/evaluation-hardware-and-software/evaluation-boards-kits/adalm2000.html" target="_blank" rel="noopener noreferrer" style={link}>ADALM2000 product page</a>.
          </p>
        </div>
      </div>
    </div>
  )
}
