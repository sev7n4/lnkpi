export type ModelCapability = 'text' | 'image' | 'video' | 'audio'
export type ApiCallFormat = 'openai' | 'gemini'

export const CHANNEL_MODEL_SEPARATOR = '::'

/** Fixed copy for BYOK → platform fallback confirmation dialog */
export const BYOK_FALLBACK_CONFIRM_MESSAGE =
  '自定义渠道失败，已切换平台服务，可能会有额外费用，是否继续？'

export function encodeChannelModel(channelId: string, modelName: string): string {
  return `${channelId}${CHANNEL_MODEL_SEPARATOR}${modelName}`
}

export function decodeChannelModel(value: string): { channelId: string; modelName: string } | null {
  const separatorIndex = value.indexOf(CHANNEL_MODEL_SEPARATOR)
  if (separatorIndex === -1) return null

  const channelId = value.slice(0, separatorIndex)
  const modelName = value.slice(separatorIndex + CHANNEL_MODEL_SEPARATOR.length)
  if (!channelId || !modelName) return null

  return { channelId, modelName }
}

export function modelOptionName(value: string): string {
  const decoded = decodeChannelModel(value)
  return decoded?.modelName ?? value
}

const IMAGE_MODEL_RE =
  /(dall-?e|flux|seedream|imagen|midjourney|stable-?diffusion|sdxl|gpt-image|ideogram|recraft|banana)/i
const VIDEO_MODEL_RE =
  /(kling|seedance|sora|runway|luma|pika|hailuo|vidu|veo|wan2|cogvideo|happyhose)/i
const AUDIO_MODEL_RE = /(whisper|tts|audio|suno|fish-speech|cosyvoice|speech|voice)/i

/** Best-effort modality guess from OpenAI-compatible model ids (no modality in /models). */
export function inferModelCapability(modelName: string): ModelCapability {
  const name = modelName.trim()
  if (!name) return 'text'
  if (IMAGE_MODEL_RE.test(name)) return 'image'
  if (VIDEO_MODEL_RE.test(name)) return 'video'
  if (AUDIO_MODEL_RE.test(name)) return 'audio'
  return 'text'
}

/**
 * When re-pulling models: keep user/previous tags, else infer from name, else text.
 */
export function resolvePulledModelCapability(
  modelName: string,
  previousByName: Record<string, ModelCapability>,
): ModelCapability {
  const prev = previousByName[modelName]
  if (prev === 'text' || prev === 'image' || prev === 'video' || prev === 'audio') return prev
  return inferModelCapability(modelName)
}

export const PLATFORM_CHANNEL_ID = 'platform'

export type ChannelModelSelectOption = {
  value: string
  label: string
  capability: ModelCapability
}

function isPlatformModelValue(value: string): boolean {
  return decodeChannelModel(value)?.channelId === PLATFORM_CHANNEL_ID
}

/** Candidate list for a modality picker: match capability, optionally other BYOK, always keep selected. */
export function modelOptionsForCapability(
  pool: readonly ChannelModelSelectOption[],
  capability: ModelCapability,
  opts: { includeOtherByok?: boolean; selectedValues?: readonly string[] } = {},
): ChannelModelSelectOption[] {
  const seen = new Set<string>()
  const result: ChannelModelSelectOption[] = []

  const push = (opt: ChannelModelSelectOption) => {
    if (seen.has(opt.value)) return
    seen.add(opt.value)
    result.push(opt)
  }

  for (const opt of pool) {
    if (opt.capability === capability) push(opt)
  }

  if (opts.includeOtherByok) {
    for (const opt of pool) {
      if (opt.capability === capability) continue
      if (isPlatformModelValue(opt.value)) continue
      push(opt)
    }
  }

  const byValue = new Map(pool.map((opt) => [opt.value, opt]))
  for (const value of opts.selectedValues ?? []) {
    if (!value || seen.has(value)) continue
    const existing = byValue.get(value)
    if (existing) {
      push(existing)
      continue
    }
    const name = modelOptionName(value)
    push({
      value,
      label: name,
      capability: inferModelCapability(name),
    })
  }

  return result
}

export function filterModelNames(names: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...names]
  return names.filter((name) => name.toLowerCase().includes(q))
}

/** Inclusive-start exclusive-end range for a virtualized list window. */
export function windowedRange(
  length: number,
  scrollTop: number,
  rowHeight: number,
  viewportHeight: number,
  overscan = 8,
): { start: number; end: number } {
  if (length <= 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + overscan * 2
  let start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan)
  if (start >= length) start = Math.max(0, length - visible)
  return { start, end: Math.min(length, start + visible) }
}
