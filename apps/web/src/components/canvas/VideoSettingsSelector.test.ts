import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  DEFAULT_VIDEO_SETTINGS,
  resolveVideoModelCapabilities,
  videoAspectRatioOptionsForCapabilities,
  videoResolutionOptionsForCapabilities,
} from '@lnkpi/shared'
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

  it('shows profile-filtered aspect and resolution options for seedance standard', async () => {
    const capabilities = resolveVideoModelCapabilities('seedance-2.0', 'doubao-seedance-2.0')
    const wrapper = mount(VideoSettingsSelector, {
      props: {
        modelValue: { ...DEFAULT_VIDEO_SETTINGS },
        capabilities,
        modelKey: 'seedance-2.0',
      },
    })

    await openPopover(wrapper)
    const text = wrapper.text()
    expect(text).toContain('21:9 超宽')
    expect(text).toContain('4K')
    expect(text).not.toContain('21:9 超宽'.repeat(2))
    const arOpts = videoAspectRatioOptionsForCapabilities(capabilities)
    const resOpts = videoResolutionOptionsForCapabilities(capabilities)
    for (const opt of arOpts) {
      expect(text).toContain(opt.label)
    }
    for (const opt of resOpts) {
      expect(text).toContain(opt.label)
    }
  })

  it('patches invalid aspectRatio and resolution to first allowed on open', async () => {
    const capabilities = resolveVideoModelCapabilities('agnes-video-v2.0', 'agnes-video-v2.0')
    const wrapper = mount(VideoSettingsSelector, {
      props: {
        modelValue: {
          ...DEFAULT_VIDEO_SETTINGS,
          aspectRatio: '21:9' as typeof DEFAULT_VIDEO_SETTINGS.aspectRatio,
          resolution: '4k' as typeof DEFAULT_VIDEO_SETTINGS.resolution,
        },
        capabilities,
        modelKey: 'agnes-video-v2.0',
      },
    })

    await openPopover(wrapper)
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted?.length).toBeGreaterThan(0)
    const last = emitted!.at(-1)![0] as typeof DEFAULT_VIDEO_SETTINGS
    expect(last.aspectRatio).toBe('16:9')
    expect(last.resolution).toBe('480p')
  })
})
