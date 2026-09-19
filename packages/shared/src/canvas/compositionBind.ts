import type { LocalRefBinding, RefMediaType } from '../nodeRefs'
import type { CompositionIR } from './compositionIr'

export const COMPOSITION_BIND_MISSING =
  '参考图还没挂到构图上。请确认侧栏 @I1 起仍在本轮，或先把图加入 Agent 引用。'

const CHIP_KEY = /^@?I(\d+)$/i
const MEDIA_TYPES = new Set<RefMediaType>(['text', 'image', 'video', 'audio'])

export function compositionSlotKey(primitives: CompositionIR['primitives']): string {
  const identity = primitives.identityRef ?? ''
  const garments = [...primitives.garmentRefs].sort().join(',')
  const skipI0 = primitives.skipI0 ? '1' : '0'
  return `${identity}::${garments}::${skipI0}`
}

export function requiredCompositionRefKeys(primitives: CompositionIR['primitives']): string[] {
  const keys: string[] = []
  if (primitives.identityRef) keys.push(primitives.identityRef)
  keys.push(...primitives.garmentRefs)
  for (const other of primitives.otherRefs) keys.push(other.ref)
  return [...new Set(keys)]
}

export function compositionSourcesBound(
  requiredKeys: string[],
  byRef: Record<string, LocalRefBinding[]>,
): boolean {
  return requiredKeys.every((key) => {
    const url = byRef[key]?.[0]?.url
    return typeof url === 'string' && url.trim() !== ''
  })
}

export function localRefsByRefFromSidebarAttachments(
  utterance: string,
  attachments: unknown[] | undefined,
): Record<string, LocalRefBinding[]> {
  const images = (attachments ?? []).filter(isImageRecord)
  const mentioned = unique([...utterance.matchAll(/@I([0-9]+)/g)].map((m) => `I${m[1]}`))
  const map: Record<string, LocalRefBinding[]> = {}
  const unlabeled: { image: Record<string, unknown>; binding: LocalRefBinding }[] = []

  for (const image of images) {
    const binding = attachmentToLocalRef(image)
    if (!binding) continue
    const key = chipKeyOf(image)
    if (key) {
      if (!map[key]) map[key] = [binding]
      continue
    }
    unlabeled.push({ image, binding })
  }

  for (const item of unlabeled) {
    const key =
      mentioned.length > 0
        ? mentioned.find((ref) => !map[ref])
        : fallbackIndexKey(images, item.image, map)
    if (!key) continue
    map[key] = [item.binding]
  }

  return map
}

function isImageRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const media = String(record.mediaType ?? record.media_type ?? '')
  return media === 'image'
}

function chipKeyOf(attachment: Record<string, unknown>): string | undefined {
  return chipKeyFrom(attachment.refKey) ?? chipKeyFrom(attachment.label) ?? chipKeyFrom(attachment.id)
}

function chipKeyFrom(value: unknown): string | undefined {
  const text = String(value ?? '').trim()
  const match = text.match(CHIP_KEY)
  return match ? `I${match[1]}` : undefined
}

function fallbackIndexKey(
  images: Record<string, unknown>[],
  image: Record<string, unknown>,
  map: Record<string, LocalRefBinding[]>,
): string | undefined {
  const index = images.indexOf(image)
  if (index < 0) return undefined
  const key = `I${index + 1}`
  return map[key] ? undefined : key
}

function attachmentToLocalRef(attachment: Record<string, unknown>): LocalRefBinding | null {
  const url = typeof attachment.url === 'string' ? attachment.url.trim() : ''
  const id = String(attachment.id ?? '').trim() || url
  if (!id) return null
  const label = String(attachment.label || '图').trim() || '图'
  const mediaRaw = String(attachment.mediaType ?? attachment.media_type ?? 'image')
  const mediaType = MEDIA_TYPES.has(mediaRaw as RefMediaType)
    ? (mediaRaw as RefMediaType)
    : 'image'
  return {
    id,
    mediaType,
    sourceKind: attachment.sourceKind === 'asset' ? 'asset' : 'upload',
    label,
    ...(url ? { url } : {}),
    ...(typeof attachment.text === 'string' && attachment.text ? { text: attachment.text } : {}),
  }
}

function unique(refs: string[]): string[] {
  return [...new Set(refs)]
}
