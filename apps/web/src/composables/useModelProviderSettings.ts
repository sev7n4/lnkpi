import { ref, watch } from 'vue'

export type ProviderKind = 'text' | 'image' | 'video' | 'audio'

export interface ModelProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export type ModelProviderSettings = Record<ProviderKind, ModelProviderConfig>

const STORAGE_KEY = 'lnkpi-model-provider-settings'

export const PROVIDER_KINDS: Array<{ key: ProviderKind; label: string; hint: string }> = [
  { key: 'text', label: '文本', hint: 'OpenAI 兼容 Chat Completions' },
  { key: 'image', label: '图片', hint: 'OpenAI 兼容 Images API' },
  { key: 'video', label: '视频', hint: '视频生成服务 Base URL' },
  { key: 'audio', label: '音频', hint: 'TTS / 语音合成服务' },
]

const defaults: ModelProviderSettings = {
  text: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  image: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'dall-e-3' },
  video: { apiKey: '', baseUrl: '', model: 'kling-v1' },
  audio: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'tts-1' },
}

function loadSettings(): ModelProviderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(defaults)
    const parsed = JSON.parse(raw) as Partial<ModelProviderSettings>
    return {
      text: { ...defaults.text, ...parsed.text },
      image: { ...defaults.image, ...parsed.image },
      video: { ...defaults.video, ...parsed.video },
      audio: { ...defaults.audio, ...parsed.audio },
    }
  } catch {
    return structuredClone(defaults)
  }
}

export function useModelProviderSettings() {
  const settings = ref<ModelProviderSettings>(loadSettings())

  watch(
    settings,
    (value) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    },
    { deep: true },
  )

  function resetKind(kind: ProviderKind) {
    settings.value[kind] = { ...defaults[kind] }
  }

  function getConfig(kind: ProviderKind): ModelProviderConfig {
    return settings.value[kind]
  }

  return {
    settings,
    resetKind,
    getConfig,
    defaults,
  }
}
