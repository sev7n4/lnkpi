import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { DEFAULT_VIDEO_SETTINGS, resolveVideoModelCapabilities } from '@lnkpi/shared'
import VideoSettingsSelector from './VideoSettingsSelector.vue'

async function openPopover(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('button[title="视频参数"]').trigger('click')
}

describe('VideoSettingsSelector', () => {
  it('hides generateAudio when supportsGenerateAudio is false', async () => {
    const capabilities = resolveVideoModelCapabilities('agnes-video-v2.0', 'agnes-video-v2.0')
    const wrapper = mount(VideoSettingsSelector, {
      props: {
        modelValue: { ...DEFAULT_VIDEO_SETTINGS },
        capabilities,
        modelKey: 'agnes-video-v2.0',
      },
    })

    await openPopover(wrapper)
    expect(wrapper.text()).not.toContain('生成音频')
  })

  it('shows generateAudio for seedance models', async () => {
    const capabilities = resolveVideoModelCapabilities('seedance-2.0', 'doubao-seedance-2.0')
    const wrapper = mount(VideoSettingsSelector, {
      props: {
        modelValue: { ...DEFAULT_VIDEO_SETTINGS },
        capabilities,
        modelKey: 'seedance-2.0',
      },
    })

    await openPopover(wrapper)
    expect(wrapper.text()).toContain('生成音频')
  })

  it('hides crop when catalog crop disposition is metadataOnly', async () => {
    const wrapper = mount(VideoSettingsSelector, {
      props: {
        modelValue: { ...DEFAULT_VIDEO_SETTINGS },
        modelKey: 'seedance-2.0',
      },
    })

    await openPopover(wrapper)
    expect(wrapper.text()).not.toContain('裁剪')
  })

  it('shows min duration hint when selected duration is below model minimum', async () => {
    const capabilities = resolveVideoModelCapabilities('agnes-video-v2.0', 'agnes-video-v2.0')
    const wrapper = mount(VideoSettingsSelector, {
      props: {
        modelValue: { ...DEFAULT_VIDEO_SETTINGS, duration: 4 },
        capabilities,
        modelKey: 'agnes-video-v2.0',
      },
    })

    await openPopover(wrapper)
    expect(wrapper.text()).toContain('该模型最短 5 秒')
  })
})
