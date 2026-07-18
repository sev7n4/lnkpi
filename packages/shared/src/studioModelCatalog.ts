export type StudioModality = 'text' | 'image' | 'video' | 'audio'
export type ParamDisposition = 'native' | 'promptPrefix' | 'metadataOnly'

export interface StudioVoiceOption {
  id: string
  label: string
}

export interface StudioModelEntry {
  modelKey: string
  displayName: string
  gatewayModelId: string
  modality: StudioModality
  providerBinding: 'gateway-openai-compat'
  voices?: StudioVoiceOption[]
  /** 字段名 → 处置；未列出的生成参数默认 metadataOnly */
  params: Record<string, ParamDisposition>
  defaults?: Record<string, string | number>
}

const TEXT_PARAMS: Record<string, ParamDisposition> = {
  model: 'native',
}

// I* multi-ref strategy (native / primary_image / prompt_url_tags) is resolved by the generation adapter.
const IMAGE_PARAMS: Record<string, ParamDisposition> = {
  model: 'native',
  size: 'native',
  n: 'native',
}

const VIDEO_PARAMS: Record<string, ParamDisposition> = {
  model: 'native',
  duration: 'native',
  aspectRatio: 'native',
  resolution: 'native',
  image: 'native',
  crop: 'metadataOnly',
}

const SEED_AUDIO_PARAMS: Record<string, ParamDisposition> = {
  model: 'native',
  voice: 'native',
  speed: 'native',
  // Conservative until gateway field mapping is verified.
  emotion: 'promptPrefix',
  language: 'promptPrefix',
  volume: 'metadataOnly',
  pitch: 'metadataOnly',
}

const MINIMAX_AUDIO_PARAMS: Record<string, ParamDisposition> = {
  model: 'native',
  voice: 'native',
  speed: 'native',
  volume: 'native',
  pitch: 'native',
  emotion: 'native',
  language: 'promptPrefix',
}

export const STUDIO_MODEL_CATALOG: StudioModelEntry[] = [
  // Text (§3.1)
  {
    modelKey: 'gemini-3.1-flash',
    displayName: 'Gemini 3.1 Flash',
    gatewayModelId: 'gemini-3.1-flash',
    modality: 'text',
    providerBinding: 'gateway-openai-compat',
    params: TEXT_PARAMS,
  },
  {
    modelKey: 'deepseek-v4',
    displayName: 'DeepSeek V4',
    gatewayModelId: 'deepseek-v4',
    modality: 'text',
    providerBinding: 'gateway-openai-compat',
    params: TEXT_PARAMS,
  },
  {
    modelKey: 'gpt-5.5',
    displayName: 'GPT 5.5',
    gatewayModelId: 'gpt-5.5',
    modality: 'text',
    providerBinding: 'gateway-openai-compat',
    params: TEXT_PARAMS,
  },

  // Image (§3.2)
  {
    modelKey: 'image2',
    displayName: 'Image2',
    gatewayModelId: 'image2',
    modality: 'image',
    providerBinding: 'gateway-openai-compat',
    params: IMAGE_PARAMS,
  },
  {
    modelKey: 'navo-pro',
    displayName: 'Navo Pro',
    gatewayModelId: 'navo-pro',
    modality: 'image',
    providerBinding: 'gateway-openai-compat',
    params: IMAGE_PARAMS,
  },
  {
    modelKey: 'seedream-5.0-pro',
    displayName: 'Seedream 5.0 Pro',
    gatewayModelId: 'seedream-5.0-pro',
    modality: 'image',
    providerBinding: 'gateway-openai-compat',
    params: { ...IMAGE_PARAMS, refImages: 'native' },
  },
  {
    modelKey: 'midjourney-8.1',
    displayName: 'Midjourney 8.1',
    gatewayModelId: 'midjourney-8.1',
    modality: 'image',
    providerBinding: 'gateway-openai-compat',
    params: IMAGE_PARAMS,
  },

  // Video (§3.3)
  {
    modelKey: 'seedance-2.0-min',
    displayName: 'Seedance 2.0 Min',
    gatewayModelId: 'seedance-2.0-min',
    modality: 'video',
    providerBinding: 'gateway-openai-compat',
    params: VIDEO_PARAMS,
  },
  {
    modelKey: 'happyhose-1.1',
    displayName: 'Happyhose 1.1',
    gatewayModelId: 'happyhose-1.1',
    modality: 'video',
    providerBinding: 'gateway-openai-compat',
    params: VIDEO_PARAMS,
  },
  {
    modelKey: 'wan-2.7',
    displayName: 'Wan 2.7',
    gatewayModelId: 'wan-2.7',
    modality: 'video',
    providerBinding: 'gateway-openai-compat',
    params: VIDEO_PARAMS,
  },

  // Audio (§3.4)
  {
    modelKey: 'seed-audio-1.0',
    displayName: 'Seed Audio 1.0',
    gatewayModelId: 'seed-audio-1.0',
    modality: 'audio',
    providerBinding: 'gateway-openai-compat',
    params: SEED_AUDIO_PARAMS,
    voices: [
      { id: 'seed-female-1', label: '女声 1' },
      { id: 'seed-male-1', label: '男声 1' },
      { id: 'seed-neutral-1', label: '中性 1' },
    ],
    defaults: { voice: 'seed-female-1', speed: 1.0 },
  },
  {
    modelKey: 'minimax-speech-2.8-hd',
    displayName: 'MiniMax Speech 2.8 HD',
    gatewayModelId: 'speech-2.8-hd',
    modality: 'audio',
    providerBinding: 'gateway-openai-compat',
    params: MINIMAX_AUDIO_PARAMS,
    voices: [
      { id: 'female-shaonv', label: '少女' },
      { id: 'male-qingnian', label: '青年男声' },
      { id: 'presenter_female', label: '女主播' },
    ],
    defaults: { voice: 'female-shaonv', speed: 1.0, volume: 1.0, pitch: 0 },
  },
]

const DEFAULT_MODEL_KEYS: Record<StudioModality, string> = {
  text: 'gemini-3.1-flash',
  image: 'seedream-5.0-pro',
  video: 'seedance-2.0-min',
  audio: 'minimax-speech-2.8-hd',
}

export function listModels(modality: StudioModality): StudioModelEntry[] {
  return STUDIO_MODEL_CATALOG.filter((entry) => entry.modality === modality)
}

export function getModelEntry(modelKey: string): StudioModelEntry | undefined {
  return STUDIO_MODEL_CATALOG.find((entry) => entry.modelKey === modelKey)
}

export function defaultModelKey(modality: StudioModality): string {
  return DEFAULT_MODEL_KEYS[modality]
}

export function resolveModelKey(
  modality: StudioModality,
  requested?: string | null,
): { modelKey: string; entry: StudioModelEntry; fallback: boolean } {
  const fallbackKey = defaultModelKey(modality)
  const fallbackEntry = getModelEntry(fallbackKey)!
  if (!requested) {
    return { modelKey: fallbackKey, entry: fallbackEntry, fallback: false }
  }
  const entry = getModelEntry(requested)
  if (entry?.modality === modality) {
    return { modelKey: requested, entry, fallback: false }
  }
  return { modelKey: fallbackKey, entry: fallbackEntry, fallback: true }
}
