import { computed, ref } from 'vue'
import {
  providerApi,
  type ProviderBootstrap,
  type ProviderChannelPublic,
  type ProviderPreferencesPublic,
  type ProviderWebdavPublic,
} from '@/services/provider-api'

const bootstrap = ref<ProviderBootstrap | null>(null)
const loading = ref(false)
const error = ref('')
let loadPromise: Promise<ProviderBootstrap> | null = null

export function useProviderBootstrap() {
  const platformChannel = computed(() => bootstrap.value?.platformChannel ?? null)
  const channels = computed(() => bootstrap.value?.channels ?? [])
  const preferences = computed(() => bootstrap.value?.preferences ?? null)
  const webdav = computed(() => bootstrap.value?.webdav ?? null)

  const allChannels = computed((): ProviderChannelPublic[] => {
    if (!bootstrap.value) return []
    return [bootstrap.value.platformChannel, ...bootstrap.value.channels]
  })

  async function load(force = false): Promise<ProviderBootstrap> {
    if (!force && bootstrap.value) return bootstrap.value
    if (!force && loadPromise) return loadPromise

    loading.value = true
    error.value = ''
    loadPromise = providerApi
      .bootstrap()
      .then((data) => {
        bootstrap.value = data
        return data
      })
      .catch((err) => {
        error.value = err instanceof Error ? err.message : '加载配置失败'
        throw err
      })
      .finally(() => {
        loading.value = false
        loadPromise = null
      })

    return loadPromise
  }

  function setBootstrap(data: ProviderBootstrap) {
    bootstrap.value = data
  }

  function patchChannels(next: ProviderChannelPublic[]) {
    if (!bootstrap.value) return
    bootstrap.value = { ...bootstrap.value, channels: next }
  }

  function patchChannel(channel: ProviderChannelPublic) {
    if (!bootstrap.value) return
    if (channel.id === bootstrap.value.platformChannel.id) {
      bootstrap.value = { ...bootstrap.value, platformChannel: channel }
      return
    }
    bootstrap.value = {
      ...bootstrap.value,
      channels: bootstrap.value.channels.map((c) => (c.id === channel.id ? channel : c)),
    }
  }

  function patchPreferences(prefs: ProviderPreferencesPublic) {
    if (!bootstrap.value) return
    bootstrap.value = { ...bootstrap.value, preferences: prefs }
  }

  function patchWebdav(config: ProviderWebdavPublic) {
    if (!bootstrap.value) return
    bootstrap.value = { ...bootstrap.value, webdav: config }
  }

  return {
    bootstrap,
    loading,
    error,
    platformChannel,
    channels,
    preferences,
    webdav,
    allChannels,
    load,
    setBootstrap,
    patchChannels,
    patchChannel,
    patchPreferences,
    patchWebdav,
  }
}
