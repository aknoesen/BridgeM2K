// PNG export of a live <svg> (schematic / breadboard) so students can save a clean image for their
// prelab submission instead of cropping a screenshot. No dependencies.
//
// The drawings colour themselves from CSS custom properties (the dark theme: --ch1-color, etc.).
// Those don't survive XML serialization, so before rasterizing we walk the clone and inline each
// element's *computed* paint (which has already resolved the variables to rgb). url(...) references
// (gradients) are left alone so they still resolve inside the standalone SVG.
//
// `light: true` turns the dark-theme drawing into a paper figure: every paint colour has its HSL
// lightness inverted (near-black background → white, light-grey text/wires → dark ink, hues kept),
// the grid pattern is dropped, and the canvas is filled white. That reads cleanly on a white
// Gradescope/Word page, where the unmodified light-on-dark palette would wash out.

const PAINT_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
] as const

// Invert the lightness of an "rgb(...)"/"rgba(...)" colour, preserving hue, saturation, and alpha.
function invertLightness(color: string): string {
  const m = color.match(/rgba?\(([^)]+)\)/i)
  if (!m) return color
  const p = m[1].split(',').map((s) => s.trim())
  let r = Number(p[0]), g = Number(p[1]), b = Number(p[2])
  const a = p.length > 3 ? Number(p[3]) : 1
  if ([r, g, b].some((n) => Number.isNaN(n))) return color
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const l = (max + min) / 2
  let h = 0, s = 0
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  const nl = 1 - l // the inversion
  const hue2rgb = (pp: number, qq: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1
    if (t < 1 / 6) return pp + (qq - pp) * 6 * t
    if (t < 1 / 2) return qq
    if (t < 2 / 3) return pp + (qq - pp) * (2 / 3 - t) * 6
    return pp
  }
  let R: number, G: number, B: number
  if (s === 0) { R = G = B = nl } else {
    const q = nl < 0.5 ? nl * (1 + s) : nl + s - nl * s
    const pp = 2 * nl - q
    R = hue2rgb(pp, q, h + 1 / 3); G = hue2rgb(pp, q, h); B = hue2rgb(pp, q, h - 1 / 3)
  }
  return `rgba(${Math.round(R * 255)},${Math.round(G * 255)},${Math.round(B * 255)},${a})`
}

function inlinePaint(src: Element, dst: Element, light: boolean) {
  if (src.tagName === 'defs') return // leave pattern/gradient definitions untouched
  const cs = window.getComputedStyle(src)
  const decl: string[] = []
  for (const p of PAINT_PROPS) {
    let v = cs.getPropertyValue(p)
    if (!v) continue
    if (p === 'fill' || p === 'stroke') {
      if (v.startsWith('url(')) continue            // keep pattern/gradient references as-is
      if (light && v !== 'none') v = invertLightness(v)
    }
    decl.push(`${p}:${v}`)
  }
  if (decl.length) dst.setAttribute('style', decl.join(';'))
  const s = src.children, d = dst.children
  const n = Math.min(s.length, d.length)
  for (let i = 0; i < n; i++) inlinePaint(s[i], d[i], light)
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

interface ExportOpts { scale?: number; light?: boolean }

/**
 * Rasterize an on-screen SVG element to a PNG and download it.
 * @param svg   the live <svg> (must be in the DOM so computed styles resolve)
 * @param filename  e.g. 'schematic.png'
 * @param opts.scale  pixel density multiplier (default 2)
 * @param opts.light  true → white background + dark-ink remap (default false = transparent)
 */
export async function exportSvgToPng(svg: SVGSVGElement, filename: string, opts: ExportOpts = {}): Promise<void> {
  const scale = opts.scale ?? 2
  const light = opts.light ?? false

  const vb = svg.viewBox?.baseVal
  const box = svg.getBoundingClientRect()
  const w = vb && vb.width ? vb.width : box.width
  const h = vb && vb.height ? vb.height : box.height
  if (!w || !h) throw new Error('Nothing to export yet.')

  const clone = svg.cloneNode(true) as SVGSVGElement
  if (light) clone.querySelectorAll('[fill^="url("]').forEach((el) => el.remove()) // drop the grid
  inlinePaint(svg, clone, light)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.style.background = 'transparent' // the canvas owns the background

  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not render the SVG.'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable.')
    if (light) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, w, h)
    triggerDownload(canvas.toDataURL('image/png'), filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}
