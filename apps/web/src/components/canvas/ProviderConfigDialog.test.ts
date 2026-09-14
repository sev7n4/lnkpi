import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ProviderConfigDialog from './ProviderConfigDialog.vue'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return {
    ...actual,
    ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }
})

vi.mock('@/composables/useProviderBootstrap', async () => {
  const { computed, ref } = await import('vue')
  const models = Array.from({ length: 300 }, (_, i) => ({
    name: `model-${i}`,
    capability: i % 2 === 0 ? ('text' as const) : ('image' as const),
  }))
  const platformChannel = {
    id: 'platform',
    name: '平台',
    apiFormat: 'openai' as const,
    baseUrl: '',
    models: [{ name: 'agnes-image', capability: 'image' as const }],
    hasApiKey: true,
    readOnly: true,
    createdAt: '',
    updatedAt: '',
  }
  const userChannel = {
    id: 'ch1',
    name: 'BYOK',
    apiFormat: 'openai' as const,
    baseUrl: 'https://api.example.com/v1',
    models,
    hasApiKey: true,
    readOnly: false,
    createdAt: '',
    updatedAt: '',
  }
  const preferences = {
    selectableImageModels: [],
    selectableVideoModels: [],
    selectableTextModels: [],
    selectableAudioModels: [],
    defaultImageModel: '',
    defaultVideoModel: '',
    defaultTextModel: '',
    defaultAudioModel: '',
    canvasImageCount: 1,
    defaultImageAspect: '16:9',
    defaultImageResolution: '1K',
    defaultVideoAspect: '16:9',
    defaultVideoDuration: 5,
    defaultVideoResolution: '720p',
    defaultVideoCrop: 'none',
    audioVoice: 'female-shaonv',
    audioFormat: 'mp3',
    audioSpeed: 1,
    audioInstructions: null,
    systemPrompt: null,
  }
  const webdav = {
    url: '',
    directory: '',
    username: '',
    hasPassword: false,
    connectionMode: 'proxy' as const,
    lastSyncedAt: null,
  }
  const allChannels = ref([platformChannel, userChannel])
  return {
    useProviderBootstrap: () => ({
      load: vi.fn().mockResolvedValue({
        platformChannel,
        channels: [userChannel],
        preferences,
        webdav,
      }),
      loading: ref(false),
      allChannels: computed(() => allChannels.value),
      preferences: ref(preferences),
      webdav: ref(webdav),
      patchChannel: vi.fn(),
      patchPreferences: vi.fn(),
      patchWebdav: vi.fn(),
      setBootstrap: vi.fn(),
    }),
  }
})

describe('ProviderConfigDialog', () => {
  it('window-renders channel models and capability-filters selectable options', async () => {
    const wrapper = mount(ProviderConfigDialog, {
      props: { modelValue: false },
      global: { plugins: [ElementPlus] },
    })

    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    const rows = wrapper.findAll('.channel-model-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(40)
    expect(wrapper.findAll('.el-select').length).toBeLessThan(10)

    const modelTab = wrapper.findAll('.el-tabs__item').find((item) => item.text() === '模型')
    expect(modelTab).toBeTruthy()
    await modelTab!.trigger('click')
    await flushPromises()

    const selects = wrapper.findAllComponents({ name: 'ElSelectV2' })
    expect(selects.length).toBe(4)
    const imageOptions = selects[0].props('options') as Array<{ value: string }>
    expect(imageOptions.some((opt) => opt.value.endsWith('agnes-image'))).toBe(true)
    expect(imageOptions.some((opt) => opt.value.endsWith('model-1'))).toBe(true)
    expect(imageOptions.some((opt) => opt.value.endsWith('model-0'))).toBe(false)
    expect(imageOptions.length).toBeLessThan(200)
  })
})
