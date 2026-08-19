import { clampWipeRatio } from '@/utils/refineChrome'

export function wipeHoldRatio(showingOriginal: boolean, wipeRatio: number): number {
  if (showingOriginal) return 0
  return clampWipeRatio(wipeRatio)
}
