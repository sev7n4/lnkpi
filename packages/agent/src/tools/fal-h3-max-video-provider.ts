import type { VideoGenerateOptions, VideoProvider } from './video-provider'
import { runFalVideoQueue } from './fal-video-queue'

export const FAL_H3_MAX_ENDPOINTS = {
  'h3-max-turbo': {
    t2v: 'minimax/h3-max-turbo/text-to-video',
    i2v: 'minimax/h3-max-turbo/image-to-video',
  },
  'h3-max': {
    t2v: 'minimax/h3-max/text-to-video',
    i2v: 'minimax/h3-max/image-to-video',
  },
} as const

type FalH3MaxFamily = keyof typeof FAL_H3_MAX_ENDPOINTS

function resolveFamily(model?: string): FalH3MaxFamily {
  const key = (model ?? '').toLowerCase()
  if (key.includes('h3-max-turbo')) return 'h3-max-turbo'
  if (key.includes('h3-max')) return 'h3-max'
  return 'h3-max-turbo'
}

function mapResolution(resolution?: string): string | undefined {
  if (!resolution?.trim()) return undefined
  const normalized = resolution.trim()
  if (/^480p$/i.test(normalized)) return '480P'
  if (/^768p$/i.test(normalized)) return '768P'
  return normalized
}

function isEndRole(role: string): boolean {
  return /(end|last)/i.test(role)
}

function resolveStartImage(options?: VideoGenerateOptions): string | undefined {
  const fromImage = options?.image?.trim()
  if (fromImage) return fromImage
  const fromRefs = options?.referenceImages?.[0]?.trim()
  if (fromRefs) return fromRefs
  const fromRoles = options?.imageWithRoles?.find((entry) => !isEndRole(entry.role))?.url?.trim()
  return fromRoles || undefined
}

function resolveEndImage(options?: VideoGenerateOptions): string | undefined {
  const fromRefs = options?.referenceImages?.[1]?.trim()
  if (fromRefs) return fromRefs
  const fromRoles = options?.imageWithRoles?.find((entry) => isEndRole(entry.role))?.url?.trim()
  return fromRoles || undefined
}

export class FalH3MaxVideoProvider implements VideoProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://fal.run',
    private defaultModel = 'h3-max-turbo',
  ) {}

  async generate(
    prompt: string,
    options?: VideoGenerateOptions,
  ): Promise<{ url: string }> {
    const family = resolveFamily(options?.model ?? this.defaultModel)
    const startImage = resolveStartImage(options)
    const endImage = resolveEndImage(options)
    const mode = startImage || endImage ? 'i2v' : 't2v'
    const endpointId = FAL_H3_MAX_ENDPOINTS[family][mode]

    const input: Record<string, unknown> = { prompt }
    if (options?.duration != null && Number.isFinite(options.duration)) {
      input.duration = Math.round(options.duration)
    }
    if (options?.aspectRatio) input.aspect_ratio = options.aspectRatio
    const resolution = mapResolution(options?.resolution)
    if (resolution) input.resolution = resolution
    if (startImage) input.image_url = startImage
    if (endImage) input.end_image_url = endImage

    return runFalVideoQueue({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      endpointId,
      input,
      pollIntervalMs: options?.pollIntervalMs,
      maxPollMs: options?.maxPollMs,
    })
  }
}
