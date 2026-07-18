export const BASE_GENERATION_CREDITS = {
  text: 5,
  image: 10,
  video: 30,
  audio: 5,
} as const

export type CreditGenerationType = keyof typeof BASE_GENERATION_CREDITS

const VIDEO_DURATION_CREDITS: Record<number, number> = {
  5: 30,
  10: 50,
  15: 70,
}

export function estimateTextCredits(): number {
  return BASE_GENERATION_CREDITS.text
}

export function estimateImageCredits(count = 1): number {
  return BASE_GENERATION_CREDITS.image * Math.max(1, count)
}

export function estimateVideoCredits(durationSec = 5): number {
  return VIDEO_DURATION_CREDITS[durationSec] ?? BASE_GENERATION_CREDITS.video
}

export function estimateAudioCredits(): number {
  return BASE_GENERATION_CREDITS.audio
}
