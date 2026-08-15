/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { encodeChannelModel } from '@lnkpi/shared'
import { useVideoModelCapabilities } from './useVideoModelCapabilities'

describe('useVideoModelCapabilities', () => {
  it('agnes model has supportsGenerateAudio=false', () => {
    const videoModel = ref(encodeChannelModel('platform', 'agnes-video-v2.0'))
    const { capabilities } = useVideoModelCapabilities(videoModel)
    expect(capabilities.value.supportsGenerateAudio).toBe(false)
  })

  it('seedance has supportsFirstLastFrame=true', () => {
    const videoModel = ref(encodeChannelModel('platform', 'seedance-2.0'))
    const { capabilities } = useVideoModelCapabilities(videoModel)
    expect(capabilities.value.supportsFirstLastFrame).toBe(true)
  })
})
