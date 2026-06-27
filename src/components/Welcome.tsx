// Welcome / landing screen — brand front door shown on first visit; "Launch" enters the twin.
// Click the sidebar logo any time to return here.

interface Props { onEnter: () => void }

const cyan = '#2ee6ff'

export default function Welcome({ onEnter }: Props) {
  const base = import.meta.env.BASE_URL
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 26, padding: 24, textAlign: 'center', color: 'var(--text-primary)',
      background: 'radial-gradient(circle at 50% 34%, #10171f, #05070a 72%)',
    }}>
      <img src={`${base}bridgem2k-lockup.svg`} alt="BridgeM2K" style={{ width: 'min(560px, 82vw)', maxHeight: 180 }} />

      <p style={{ maxWidth: 680, fontSize: 16, lineHeight: 1.7, color: 'var(--text-secondary)', margin: 0 }}>
        A browser-based digital twin of the Analog Devices ADALM2000. Draw a circuit, measure it with a
        full bench of instruments, and transfer it to a solderless breadboard — all in your browser, with
        no hardware and nothing to install.
      </p>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
        <span><b style={{ color: cyan }}>Draw</b> a circuit</span>
        <span><b style={{ color: cyan }}>Measure</b> it — scope, spectrum, Bode, meter, supply</span>
        <span><b style={{ color: cyan }}>Build</b> it on a virtual breadboard</span>
      </div>

      <button onClick={onEnter} style={{
        marginTop: 8, padding: '12px 32px', fontSize: 15, fontWeight: 600, color: '#06121a',
        background: cyan, border: 'none', borderRadius: 8, cursor: 'pointer',
        boxShadow: '0 0 26px rgba(46,230,255,0.45)',
      }}>
        Launch BridgeM2K →
      </button>

      <div style={{ position: 'absolute', bottom: 18, fontSize: 11, color: 'var(--text-secondary)', opacity: 0.75 }}>
        Open source · MIT License · UC Davis EEC1 ·{' '}
        <a href="https://github.com/aknoesen/m2k-scopy-web" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)' }}>GitHub</a>
      </div>
    </div>
  )
}
