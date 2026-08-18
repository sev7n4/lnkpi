export const MIN_MASK_COVERAGE = 0.003
export const FULL_MASK_HINT_COVERAGE = 0.97

export function maskCoverageRatio(
  alphaOrLuma: Uint8ClampedArray | Uint8Array,
  pixelCount: number,
): number {
  let selected = 0
  for (let i = 0; i < pixelCount; i++) {
    if ((alphaOrLuma[i] ?? 0) > 127) selected++
  }
  return selected / pixelCount
}

export function maskCoverageMessage(ratio: number): 'empty' | 'full' | 'ok' {
  if (ratio < MIN_MASK_COVERAGE) return 'empty'
  if (ratio >= FULL_MASK_HINT_COVERAGE) return 'full'
  return 'ok'
}
