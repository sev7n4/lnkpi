/**
 * Compatibility shim for Dock panels until Task 7 binds selectors to preferences.
 * Deliberately does NOT persist API keys (or any secrets) to localStorage.
 */
import { computed } from 'vue'
import { defaultModelKey, encodeChannelModel } from '@lnkpi/shared'
import { useProviderBootstrap } from '@/composables/useProviderBootstrap'

export type ProviderKind = 'text' | 'image' | 'video' | 'audio'

export interface ModelProviderConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export type ModelProviderSettings = Record<ProviderKind, ModelProviderConfig>

const LEGACY_STORAGE_KEY = 'lnkpi-model-provider-settings'

export const PROVIDER_KINDS: Array<{ key: ProviderKind; label: string; hint: string }> = [
  { key: 'text', label: '文本', hint: 'OpenAI 兼容 Chat Completions' },
  { key: 'image', label: '图片', hint: 'OpenAI 兼容 Images API' },
  { key: 'video', label: '视频', hint: '视频生成服务 Base URL' },
  { key: 'audio', label: '音频', hint: 'TTS / 语音合成服务' },
]

function clearLegacyPlaintextStorage() {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // ignore
  }
}

clearLegacyPlaintextStorage()

function catalogFallback(kind: ProviderKind): ModelProviderConfig {
  return {
    apiKey: '',
    baseUrl: '',
    model: encodeChannelModel('platform', defaultModelKey(kind)),
  }
}

export function useModelProviderSettings() {
  const { preferences } = useProviderBootstrap()

  const settings = computed<ModelProviderSettings>(() => {
    const prefs = preferences.value
    if (!prefs) {
      return {
        text: catalogFallback('text'),
        image: catalogFallback('image'),
        video: catalogFallback('video'),
        audio: catalogFallback('audio'),
      }
    }
    return {
      text: { apiKey: '', baseUrl: '', model: prefs.defaultTextModel || catalogFallback('text').model },
      image: { apiKey: '', baseUrl: '', model: prefs.defaultImageModel || catalogFallback('image').model },
      video: { apiKey: '', baseUrl: '', model: prefs.defaultVideoModel || catalogFallback('video').model },
      audio: { apiKey: '', baseUrl: '', model: prefs.defaultAudioModel || catalogFallback('audio').model },
    }
  })

  function getConfig(kind: ProviderKind): ModelProviderConfig {
    return settings.value[kind]
  }

  function resetKind(_kind: ProviderKind) {
    // no-op: settings are server-backed via ProviderConfigDialog
  }

  return {
    settings,
    resetKind,
    getConfig,
    defaults: {
      text: catalogFallback('text'),
      image: catalogFallback('image'),
      video: catalogFallback('video'),
      audio: catalogFallback('audio'),
    } satisfies ModelProviderSettings,
  }
}
