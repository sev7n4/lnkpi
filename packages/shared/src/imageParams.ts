export type ImageResolutionTier = '1K' | '2K' | '4K'

const RESOLUTION_LONG_EDGE: Record<ImageResolutionTier, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
}

/** Map aspect ratio + resolution tier to provider size string like "1024x1024". */
export function resolveImageSize(aspectRatio = '16:9', resolution: ImageResolutionTier = '1K'): string {
  const long = RESOLUTION_LONG_EDGE[resolution] ?? 1024
  const [awRaw, ahRaw] = aspectRatio.split(':').map(Number)
  const aw = Number.isFinite(awRaw) && awRaw > 0 ? awRaw : 16
  const ah = Number.isFinite(ahRaw) && ahRaw > 0 ? ahRaw : 9

  let width: number
  let height: number
  if (aw >= ah) {
    width = long
    height = Math.round((long * ah) / aw)
  } else {
    height = long
    width = Math.round((long * aw) / ah)
  }

  // Keep multiples of 8 for common diffusion backends
  width = Math.max(256, Math.round(width / 8) * 8)
  height = Math.max(256, Math.round(height / 8) * 8)
  return `${width}x${height}`
}
