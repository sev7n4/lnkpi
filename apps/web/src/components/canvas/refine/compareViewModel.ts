import { clampWipeRatio } from '@/utils/refineChrome'
import type { CompareMode } from '@/utils/refineChrome'

export function wipeHoldRatio(showingOriginal: boolean, wipeRatio: number): number {
  if (showingOriginal) return 0
  return clampWipeRatio(wipeRatio)
}

export function shouldRenderWipe(mode: CompareMode): boolean {
  return mode === 'wipe'
}

export function wipeAfterSrc(afterUrl: string | undefined, beforeUrl: string): string {
  return afterUrl || beforeUrl
}
