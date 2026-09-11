/** Matches ImageParamsSelector aspect options (avoid importing the Vue SFC from plain TS). */
type ImageAspectRatio =
  | '1:1'
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | '21:9'

/**
 * Best-effort map of guide preferredParams.size (e.g. "1024x1536") → Image Dock aspect.
 * Only returns when the ratio matches an existing selector option unambiguously.
 * Resolution / quality / background are NOT mapped here — full preferredParams merge
 * is deferred to the Image 2.5 specialty (image2 ratio_resolution wire is ambiguous).
 */
const ASPECT_OPTIONS: ImageAspectRatio[] = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '21:9',
]

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

export function mapPreferredSizeToAspect(size?: string): ImageAspectRatio | null {
  if (!size?.trim()) return null
  const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size.trim())
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null

  const g = gcd(w, h)
  const simplified = `${w / g}:${h / g}`
  if ((ASPECT_OPTIONS as string[]).includes(simplified)) {
    return simplified as ImageAspectRatio
  }

  const target = w / h
  for (const opt of ASPECT_OPTIONS) {
    const [a, b] = opt.split(':').map(Number)
    if (Math.abs(a / b - target) < 1e-9) return opt
  }
  return null
}
