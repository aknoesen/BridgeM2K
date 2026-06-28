// PNG export of a live <svg> (schematic / breadboard) so students can save a clean image for their
// prelab submission instead of cropping a screenshot. No dependencies.
//
// The drawings colour themselves from CSS custom properties (the dark theme: --ch1-color, etc.).
// Those don't survive XML serialization, so before rasterizing we walk the clone and inline each
// element's *computed* paint (which has already resolved the variables to rgb). url(...) references
// (the grid-dot pattern, gradients) are left as attributes so they still resolve inside the
// standalone SVG. Background stays transparent.

const PAINT_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
] as const

function inlinePaint(src: Element, dst: Element) {
  const cs = window.getComputedStyle(src)
  const decl: string[] = []
  for (const p of PAINT_PROPS) {
    const v = cs.getPropertyValue(p)
    if (!v) continue
    // Keep pattern/gradient references as-is (resolved url() would point outside the standalone SVG).
    if ((p === 'fill' || p === 'stroke') && v.startsWith('url(')) continue
    decl.push(`${p}:${v}`)
  }
  if (decl.length) dst.setAttribute('style', decl.join(';'))
  const s = src.children, d = dst.children
  const n = Math.min(s.length, d.length)
  for (let i = 0; i < n; i++) inlinePaint(s[i], d[i])
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * Rasterize an on-screen SVG element to a transparent PNG and download it.
 * @param svg   the live <svg> (must be in the DOM so computed styles resolve)
 * @param filename  e.g. 'schematic.png'
 * @param scale  pixel density multiplier (2 = crisp on hi-dpi / when zoomed)
 */
export async function exportSvgToPng(svg: SVGSVGElement, filename: string, scale = 2): Promise<void> {
  // Pixel size: prefer the viewBox (board), else the rendered box (schematic has no viewBox).
  const vb = svg.viewBox?.baseVal
  const box = svg.getBoundingClientRect()
  const w = vb && vb.width ? vb.width : box.width
  const h = vb && vb.height ? vb.height : box.height
  if (!w || !h) throw new Error('Nothing to export yet.')

  const clone = svg.cloneNode(true) as SVGSVGElement
  inlinePaint(svg, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.style.background = 'transparent' // do not bake the dark theme bg into the image

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
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0, w, h)
    triggerDownload(canvas.toDataURL('image/png'), filename)
  } finally {
    URL.revokeObjectURL(url)
  }
}
