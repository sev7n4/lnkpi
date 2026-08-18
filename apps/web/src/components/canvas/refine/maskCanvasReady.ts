export function isRealBitmapSize(width?: number, height?: number): boolean {
  return Number(width) > 1 && Number(height) > 1
}

export function isMaskDrawReady(input: { disabled?: boolean; sizeReady: boolean }): boolean {
  return !input.disabled && input.sizeReady
}
