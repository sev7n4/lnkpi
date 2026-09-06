import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MediaInfoSummary from './MediaInfoSummary.vue'

describe('MediaInfoSummary', () => {
  it('renders audio as duration · format · size', () => {
    const w = mount(MediaInfoSummary, {
      props: { kind: 'audio', durationSec: 65, format: 'MP3', bytes: 1024 * 1024 },
    })
    expect(w.text()).toContain('1:05')
    expect(w.text()).toContain('MP3')
    expect(w.text()).toContain('1.0MB')
  })

  it('video line ignores durationSec', () => {
    const w = mount(MediaInfoSummary, {
      props: {
        kind: 'video',
        resolution: '720p',
        aspectRatio: '16:9',
        bytes: 2048,
        durationSec: 99,
      },
    })
    expect(w.text()).toContain('720p')
    expect(w.text()).not.toContain('1:39')
    expect(w.text()).not.toContain('99')
  })

  it('image line keeps dims · aspect · size', () => {
    const w = mount(MediaInfoSummary, {
      props: { kind: 'image', width: 1024, height: 1024, aspectRatio: '1:1', bytes: 512 },
    })
    expect(w.text()).toContain('1024×1024')
    expect(w.text()).toContain('1:1')
  })
})
