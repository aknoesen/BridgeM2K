// About panel — app identity, Apache-2.0 license, and third-party open-source credits.
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

// Build a "new issue" URL with the bug template pre-filled, auto-including the reporter's browser
// and page address (the two things people usually forget). Computed at click time so it reflects
// the actual session. The body param means GitHub uses this instead of the repo template file;
// both coexist (the template file serves people who open issues from the GitHub Issues tab).
function reportBugUrl(): string {
  const body = [
    '**What went wrong?**',
    '',
    '',
    '**Steps to reproduce**',
    '1. ',
    '2. ',
    '',
    '**What did you expect instead?**',
    '',
    '',
    '**Error details (if a panel showed a red error box, paste its details here)**',
    '',
    '```',
    '',
    '```',
    '',
    '---',
    `Page: ${location.href}`,
    `Browser/OS: ${navigator.userAgent}`,
  ].join('\n')
  return `${REPO}/issues/new?labels=bug&title=${encodeURIComponent('[Bug] ')}&body=${encodeURIComponent(body)}`
}

export default function About() {
  return (
    <div className="instrument-panel">
      <div className="display-area">
        <div className="display-header"><span className="display-title">About</span></div>
        <div style={{ padding: 24, overflow: 'auto', maxWidth: 760, lineHeight: 1.7, color: 'var(--text-primary)' }}>
          <h2 style={{ color: '#2ee6ff', margin: '0 0 4px', letterSpacing: '0.01em' }}>BridgeM2K</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
            A browser-based digital twin of the Analog Devices ADALM2000 (M2K), built for introductory
            analog and mixed-signal courses. Draw a circuit, measure it with the same instruments
            you will use on the bench, and transfer it to a solderless breadboard — no hardware required.
          </p>

          <h3 style={{ marginBottom: 4 }}>Found a bug?</h3>
          <p style={{ marginTop: 0 }}>
            <a href={reportBugUrl()} target="_blank" rel="noopener noreferrer" style={link}>Report a bug on GitHub</a>
            {' — '}<span style={{ color: 'var(--text-secondary)' }}>opens a pre-filled report with your
            browser already filled in (a free GitHub account is needed to submit).</span>
          </p>

          <h3 style={{ marginBottom: 4 }}>License</h3>
          <p style={{ marginTop: 0 }}>
            BridgeM2K is open source under the <b>Apache License 2.0</b>. © 2026 André Knoesen.{' '}
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
