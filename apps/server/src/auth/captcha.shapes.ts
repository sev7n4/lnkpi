export type CaptchaShapeId = 'rect' | 'circle' | 'puzzle'

export const CAPTCHA_SHAPES: CaptchaShapeId[] = ['rect', 'circle', 'puzzle']

/** Extra pixels needed around piece bbox for puzzle tabs. */
export function shapePadding(shape: CaptchaShapeId): number {
  return shape === 'puzzle' ? 12 : 2
}

/**
 * White opaque shape on transparent square — used as dest-in / dest-out mask.
 * ViewBox is [0,0,size]x[0,size] for rect/circle; puzzle may draw slightly outside
 * and callers should pad the canvas.
 */
export function buildShapeMaskSvg(shape: CaptchaShapeId, size: number, pad = 0): string {
  const s = size
  const ox = pad
  const oy = pad
  const w = s + pad * 2
  const h = s + pad * 2

  let body: string
  if (shape === 'circle') {
    const r = s / 2
    body = `<circle cx="${ox + r}" cy="${oy + r}" r="${r}" fill="white"/>`
  } else if (shape === 'rect') {
    body = `<rect x="${ox}" y="${oy}" width="${s}" height="${s}" rx="8" fill="white"/>`
  } else {
    const tab = 10
    const x = ox
    const y = oy
    // Top tab + right tab puzzle silhouette
    body = `<path fill="white" d="
      M ${x + 8} ${y}
      L ${x + s * 0.35} ${y}
      C ${x + s * 0.35} ${y - tab}, ${x + s * 0.65} ${y - tab}, ${x + s * 0.65} ${y}
      L ${x + s - 8} ${y}
      Q ${x + s} ${y} ${x + s} ${y + 8}
      L ${x + s} ${y + s * 0.35}
      C ${x + s + tab} ${y + s * 0.35}, ${x + s + tab} ${y + s * 0.65}, ${x + s} ${y + s * 0.65}
      L ${x + s} ${y + s - 8}
      Q ${x + s} ${y + s} ${x + s - 8} ${y + s}
      L ${x + 8} ${y + s}
      Q ${x} ${y + s} ${x} ${y + s - 8}
      L ${x} ${y + 8}
      Q ${x} ${y} ${x + 8} ${y}
      Z"/>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
}

/** Full-canvas hole mask: transparent except white shape at (x,y). */
export function buildHoleMaskSvg(
  shape: CaptchaShapeId,
  canvasW: number,
  canvasH: number,
  x: number,
  y: number,
  size: number,
): string {
  const pad = shapePadding(shape)
  const inner = buildShapeMaskSvg(shape, size, pad)
  // Re-embed path positioned: easier to place a group translate
  const s = size
  let body: string
  if (shape === 'circle') {
    const r = s / 2
    body = `<circle cx="${x + r}" cy="${y + r}" r="${r}" fill="white"/>`
  } else if (shape === 'rect') {
    body = `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="8" fill="white"/>`
  } else {
    const tab = 10
    body = `<path fill="white" d="
      M ${x + 8} ${y}
      L ${x + s * 0.35} ${y}
      C ${x + s * 0.35} ${y - tab}, ${x + s * 0.65} ${y - tab}, ${x + s * 0.65} ${y}
      L ${x + s - 8} ${y}
      Q ${x + s} ${y} ${x + s} ${y + 8}
      L ${x + s} ${y + s * 0.35}
      C ${x + s + tab} ${y + s * 0.35}, ${x + s + tab} ${y + s * 0.65}, ${x + s} ${y + s * 0.65}
      L ${x + s} ${y + s - 8}
      Q ${x + s} ${y + s} ${x + s - 8} ${y + s}
      L ${x + 8} ${y + s}
      Q ${x} ${y + s} ${x} ${y + s - 8}
      L ${x} ${y + 8}
      Q ${x} ${y} ${x + 8} ${y}
      Z"/>`
  }
  void inner
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">${body}</svg>`
}
