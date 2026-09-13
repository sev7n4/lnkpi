import { FAL_H3_MAX_ENDPOINTS } from '@lnkpi/agent'

export function videoCredits(duration: number): number {
  if (duration >= 15) return 70
  if (duration >= 10) return 50
  return 30
}

export function videoCreditsForModel(input: {
  duration: number
  modelKey?: string
  resolution?: string
}): number {
  const base = videoCredits(input.duration)
  const key = (input.modelKey || '').toLowerCase()
  const res = (input.resolution || '768p').toLowerCase()
  if (!key.includes('h3-max')) return base
  const isTurbo = key.includes('turbo')
  // spec §5:
  // turbo+480 → ×1.0; turbo+768 → ×1.2; max+480 → ×1.2; max+768 → ×1.5
  let factor = 1.5
  if (isTurbo && res.includes('480')) factor = 1.0
  else if (isTurbo) factor = 1.2
  else if (res.includes('480')) factor = 1.2
  return Math.ceil(base * factor)
}

export function falH3MaxVideoRecordMeta(input: {
  modelKey?: string
  hasStartImage?: boolean
  credentialSource?: string
}): {
  providerId?: 'fal'
  credentialSource?: string
  falEndpoint?: string
} {
  const key = (input.modelKey || '').toLowerCase()
  if (!key.includes('h3-max')) return {}
  const family = key.includes('turbo') ? 'h3-max-turbo' : 'h3-max'
  const mode = input.hasStartImage ? 'i2v' : 't2v'
  return {
    providerId: 'fal',
    credentialSource: input.credentialSource,
    falEndpoint: FAL_H3_MAX_ENDPOINTS[family][mode],
  }
}
