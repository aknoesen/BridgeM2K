// Welcome / landing screen — brand front door shown on first visit; "Launch" enters the twin.
// Click the sidebar logo any time to return here.
// Colour-branded to UC Davis: Aggie Blue (#022851) + Aggie Gold (#FFBF00) per the UC Davis
// Brand Communications Guide (blue + gold are the dominant palette).

interface Props { onEnter: () => void }

const AGGIE_BLUE = '#022851'
const AGGIE_GOLD = '#FFBF00'

export default function Welcome({ onEnter }: Props) {
  const base = import.meta.env.BASE_URL
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 26, padding: 24, textAlign: 'center', color: 'var(--text-primary)',
      background: AGGIE_BLUE,
    }}>
      <img src={`${base}bridgem2k-lockup.svg`} alt="BridgeM2K" style={{ width: 'min(560px, 82vw)', maxHeight: 180 }} />

      <p style={{ maxWidth: 680, fontSize: 16, lineHeight: 1.7, color: 'rgba(255,255,255,0.82)', margin: 0 }}>
        A browser-based digital twin of the Analog Devices ADALM2000. Draw a circuit, measure it with a
        full bench of instruments, and transfer it to a solderless breadboard — all in your browser, with
        no hardware and nothing to install.
      </p>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'center', fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
        <span><b style={{ color: AGGIE_GOLD }}>Draw</b> a circuit</span>
        <span><b style={{ color: AGGIE_GOLD }}>Measure</b> it — scope, spectrum, Bode, meter, supply</span>
        <span><b style={{ color: AGGIE_GOLD }}>Build</b> it on a virtual breadboard</span>
      </div>

      <button onClick={onEnter} style={{
        marginTop: 8, padding: '12px 32px', fontSize: 15, fontWeight: 700, color: AGGIE_BLUE,
        background: AGGIE_GOLD, border: 'none', borderRadius: 8, cursor: 'pointer',
        boxShadow: '0 0 26px rgba(255,191,0,0.45)',
      }}>
        Launch BridgeM2K →
      </button>

      <div style={{ position: 'absolute', bottom: 18, fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
        Open source · MIT License · <span style={{ color: AGGIE_GOLD }}>UC Davis EEC1</span> ·{' '}
        <a href="https://github.com/aknoesen/m2k-scopy-web" target="_blank" rel="noopener noreferrer" style={{ color: AGGIE_GOLD }}>GitHub</a>
      </div>
    </div>
  )
}
