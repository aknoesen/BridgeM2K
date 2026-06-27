// About panel — app identity, MIT license, and third-party open-source credits.
import './Instrument.css'

const REPO = 'https://github.com/aknoesen/BridgeM2K'
const CREDITS = [
  { name: 'ngspice', what: 'SPICE circuit simulator (compiled to WebAssembly)', license: 'modified BSD', url: 'https://ngspice.sourceforge.io/' },
  { name: 'eecircuit-engine', what: 'ngspice-WASM wrapper + TypeScript API', license: 'MIT', url: 'https://www.npmjs.com/package/eecircuit-engine' },
  { name: 'Plotly.js', what: 'instrument plotting', license: 'MIT', url: 'https://plotly.com/javascript/' },
  { name: 'React', what: 'UI framework', license: 'MIT', url: 'https://react.dev/' },
  { name: 'Vite', what: 'build tooling', license: 'MIT', url: 'https://vitejs.dev/' },
]
const link = { color: 'var(--accent-blue)' }

export default function About() {
  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header"><span className="display-title">About</span></div>
        <div style={{ padding: 24, overflow: 'auto', maxWidth: 760, lineHeight: 1.7, color: 'var(--text-primary)' }}>
          <h2 style={{ color: '#2ee6ff', margin: '0 0 4px', letterSpacing: '0.01em' }}>BridgeM2K</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
            A browser-based digital twin of the Analog Devices ADALM2000 (M2K), built for the EEC1
            first-year ECE course at UC Davis. Draw a circuit, measure it with the same instruments
            you will use on the bench, and transfer it to a solderless breadboard — no hardware required.
          </p>

          <h3 style={{ marginBottom: 4 }}>License</h3>
          <p style={{ marginTop: 0 }}>
            BridgeM2K is open source under the <b>MIT License</b>. © 2026 aknoesen.{' '}
            <a href={REPO} target="_blank" rel="noopener noreferrer" style={link}>Source on GitHub</a>.
          </p>

          <h3 style={{ marginBottom: 4 }}>Open-source components</h3>
          <ul style={{ paddingLeft: 18, marginTop: 4 }}>
            {CREDITS.map((c) => (
              <li key={c.name} style={{ marginBottom: 4 }}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" style={link}>{c.name}</a>
                {' — '}{c.what} <span style={{ color: 'var(--text-secondary)' }}>({c.license})</span>
              </li>
            ))}
          </ul>

          <h3 style={{ marginBottom: 4 }}>Trademarks</h3>
          <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
            ADALM2000, M2K, Scopy, LTSpice, and Analog Devices are trademarks of Analog Devices, Inc.
            BridgeM2K is an independent educational project and is not affiliated with or endorsed by
            Analog Devices.
          </p>
        </div>
      </div>
    </div>
  )
}
