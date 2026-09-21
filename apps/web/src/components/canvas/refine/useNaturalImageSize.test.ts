import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNaturalImageSize } from './useNaturalImageSize'

/** jsdom 不加载图片：stub global Image，让 onload 可控触发（follow-up #4 的兜底链路） */
class FakeImage {
  static instances: FakeImage[] = []
  onload: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  src = ''
  constructor() {
    FakeImage.instances.push(this)
  }
}

describe('useNaturalImageSize', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    FakeImage.instances = []
  })

  it('元数据可信（宽高 > 1）时直接采用，不发探测', () => {
    const { width, height } = useNaturalImageSize({
      url: () => 'blob:img',
      width: () => 1024,
      height: () => 768,
    })
    expect(width.value).toBe(1024)
    expect(height.value).toBe(768)
    expect(FakeImage.instances).toHaveLength(0)
  })

  it('元数据缺失时用 Image 探测自然尺寸（follow-up #4 的断点兜底）', async () => {
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image)
    const { width, height } = useNaturalImageSize({
      url: () => 'blob:img',
      width: () => undefined,
      height: () => undefined,
    })
    expect(width.value).toBe(0)
    const img = FakeImage.instances[0]
    expect(img?.src).toBe('blob:img')
    img!.naturalWidth = 2048
    img!.naturalHeight = 1152
    img!.onload!()
    await Promise.resolve()
    expect(width.value).toBe(2048)
    expect(height.value).toBe(1152)
  })

  it('元数据只有一半（width 有 height 无）也走探测，不信任残缺数据', () => {
    vi.stubGlobal('Image', FakeImage as unknown as typeof Image)
    useNaturalImageSize({
      url: () => 'blob:img',
      width: () => 800,
      height: () => undefined,
    })
    expect(FakeImage.instances).toHaveLength(1)
  })
})
