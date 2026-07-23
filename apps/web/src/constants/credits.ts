export const BASE_GENERATION_CREDITS = {
  text: 5,
  image: 10,
  video: 30,
  audio: 5,
} as const

export type CreditGenerationType = keyof typeof BASE_GENERATION_CREDITS

export function estimateTextCredits(): number {
  return BASE_GENERATION_CREDITS.text
}

export function estimateImageCredits(count = 1): number {
  return BASE_GENERATION_CREDITS.image * Math.max(1, count)
}

export function estimateVideoCredits(durationSec = 5): number {
  const d = Number(durationSec)
  if (!Number.isFinite(d)) return BASE_GENERATION_CREDITS.video
  if (d >= 15) return 70
  if (d >= 10) return 50
  return 30
}

export function estimateAudioCredits(): number {
  return BASE_GENERATION_CREDITS.audio
}
