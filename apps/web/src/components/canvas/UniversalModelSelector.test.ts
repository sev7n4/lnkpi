import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { encodeChannelModel } from '@lnkpi/shared'
import UniversalModelSelector from './UniversalModelSelector.vue'

const visionTextModel = encodeChannelModel('ch1', 'gpt-4o')
const nonVisionTextModel = encodeChannelModel('ch1', 'deepseek-v4-pro')
const visionImageModel = encodeChannelModel('ch1', 'gpt-4o')

vi.mock('@/composables/useProviderBootstrap', () => ({
  useProviderBootstrap: () => ({
    preferences: ref({
      selectableTextModels: [visionTextModel, nonVisionTextModel],
      selectableImageModels: [visionImageModel],
      selectableVideoModels: [],
      selectableAudioModels: [],
    }),
    allChannels: ref([{ id: 'ch1', name: 'BYOK' }]),
  }),
}))

async function openDropdown(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('button[title="文本模型"]').trigger('click')
}

describe('UniversalModelSelector', () => {
  it('shows 可识图 for vision-capable text models only', async () => {
    const wrapper = mount(UniversalModelSelector, {
      props: { modelValue: visionTextModel, type: 'text' },
    })

    await openDropdown(wrapper)
    const text = wrapper.text()
    expect(text).toContain('可识图')
    expect(text.match(/可识图/g)?.length).toBe(1)
    expect(text).toContain('deepseek-v4-pro')
  })

  it('does not show 可识图 for image modality', async () => {
    const wrapper = mount(UniversalModelSelector, {
      props: { modelValue: visionImageModel, type: 'image' },
    })

    await wrapper.get('button[title="图像模型"]').trigger('click')
    expect(wrapper.text()).not.toContain('可识图')
  })
})
