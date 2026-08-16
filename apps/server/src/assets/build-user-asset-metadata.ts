import type { MediaInfo } from '@lnkpi/shared'

export interface UserAssetMetadata {
  generationRecordId?: string
  promptPreview?: string
  model?: string | null
  aspectRatio?: string
  resolution?: string
  mediaInfo?: MediaInfo
}

function parseGenerationMeta(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function buildUserAssetMetadataFromGeneration(record: {
  id: string
  prompt: string
  model?: string | null
  metadata?: string | null
}): UserAssetMetadata {
  const meta = parseGenerationMeta(record.metadata)
  const mediaInfo = meta.mediaInfo
  return {
    generationRecordId: record.id,
    promptPreview: record.prompt?.slice(0, 240) || undefined,
    model: record.model ?? null,
    aspectRatio: typeof meta.aspectRatio === 'string' ? meta.aspectRatio : undefined,
    resolution: typeof meta.resolution === 'string' ? meta.resolution : undefined,
    mediaInfo:
      mediaInfo && typeof mediaInfo === 'object' ? (mediaInfo as MediaInfo) : undefined,
  }
}

export function serializeUserAssetMetadata(payload: UserAssetMetadata): string {
  return JSON.stringify(payload)
}

export function parseUserAssetMetadata(raw?: string | null): UserAssetMetadata {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as UserAssetMetadata
  } catch {
    return {}
  }
}
