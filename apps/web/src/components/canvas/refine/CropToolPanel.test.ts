import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import CropToolPanel from './CropToolPanel.vue'
import { useCanvasEditorStore } from '@/stores/canvasEditor'

const { messageMock, loadCropSourceImage, renderCropBlob, persistMediaUrl } = vi.hoisted(() => ({
  messageMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  loadCropSourceImage: vi.fn(),
  renderCropBlob: vi.fn(),
  persistMediaUrl: vi.fn(),
}))

vi.mock('element-plus', () => ({ ElMessage: messageMock }))

vi.mock('./cropExport', () => ({
  loadCropSourceImage: (...args: unknown[]) => loadCropSourceImage(...args),
  renderCropBlob: (...args: unknown[]) => renderCropBlob(...args),
}))

vi.mock('@/composables/useMediaUpload', () => ({
  persistMediaUrl: (...args: unknown[]) => persistMediaUrl(...args),
}))

/** 单一 pinia 实例（组件注入与测试取 store 必须同源）。 */
let pinia: Pinia
const mountPanel = (props: Record<string, unknown> = {}) =>
  mount(CropToolPanel, { props, global: { plugins: [pinia] } })

describe('CropToolPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom 无 createObjectURL/revokeObjectURL（persist 回退链路需要）
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:stub'),
      revokeObjectURL: vi.fn(),
    }))
    pinia = createPinia()
    setActivePinia(pinia)
  })

  const enterCrop = () => {
    const store = useCanvasEditorStore()
    store.setRefineMode('crop')
    store.openImageEditor({ nodeId: 'node-1', url: 'https://cdn.example/source.png' })
    store.setRefineCropBase({ width: 400, height: 300 })
    return store
  }

  it('读数与旋转读出；初始 free 预设高亮', () => {
    enterCrop()
    const w = mountPanel()
    expect(w.find('[data-testid="crop-panel-readout"]').text()).toContain('400 × 300')
    expect(w.find('[data-testid="crop-rotation-readout"]').text()).toBe('0°')
    expect(w.find('[data-testid="crop-aspect-free"]').classes()).toContain('is-on')
  })

  it('比例预设点击写入 store', async () => {
    const store = enterCrop()
    const w = mountPanel()
    await w.find('[data-testid="crop-aspect-1-1"]').trigger('click')
    expect(store.refineCropAspect).toBe('1:1')
    expect(store.refineCropRect!.width).toBeCloseTo(300, 6)
  })

  it('90° 步进与复位', async () => {
    const store = enterCrop()
    const w = mountPanel()
    await w.find('[data-testid="crop-rotate-right"]').trigger('click')
    expect(store.refineCropRotationDeg).toBe(90)
    await w.find('[data-testid="crop-rotate-left"]').trigger('click')
    await w.find('[data-testid="crop-rotate-left"]').trigger('click')
    expect(store.refineCropRotationDeg).toBe(-90)
    expect(w.find('[data-testid="crop-rotation-reset"]').attributes('disabled')).toBeUndefined()
    await w.find('[data-testid="crop-rotation-reset"]').trigger('click')
    expect(store.refineCropRotationDeg).toBe(0)
  })

  it('生成裁剪：导出 → persist → 入会话（prompt 裁剪）→ 成功提示', async () => {
    const store = enterCrop()
    const img = { naturalWidth: 400, naturalHeight: 300 }
    loadCropSourceImage.mockResolvedValue(img)
    renderCropBlob.mockResolvedValue(new Blob(['x'], { type: 'image/png' }))
    persistMediaUrl.mockResolvedValue('https://cdn.example/crop.png')

    const w = mountPanel()
    await w.find('[data-testid="crop-run"]').trigger('click')
    await vi.waitFor(() => {
      expect(store.refineSessionResults).toHaveLength(1)
    })
    expect(store.refineSessionResults[0]!.prompt).toBe('裁剪')
    expect(store.refineSessionResults[0]!.url).toBe('https://cdn.example/crop.png')
    expect(messageMock.success).toHaveBeenCalled()
    expect(store.refineSessionCurrentId).toBe(store.refineSessionResults[0]!.id)
  })

  it('生成裁剪失败：报错提示且不入会话', async () => {
    const store = enterCrop()
    loadCropSourceImage.mockRejectedValue(new Error('原图加载失败'))
    const w = mountPanel()
    await w.find('[data-testid="crop-run"]').trigger('click')
    await vi.waitFor(() => {
      expect(messageMock.error).toHaveBeenCalled()
    })
    expect(store.refineSessionResults).toHaveLength(0)
    expect(store.refineBusy).toBe(false)
  })

  it('应用到画布：有会话结果才 emit apply', async () => {
    const store = enterCrop()
    const w = mountPanel()
    expect(w.find('[data-testid="crop-apply"]').attributes('disabled')).toBeDefined()
    store.pushRefineSessionResult({ url: 'https://cdn.example/crop.png', prompt: '裁剪' })
    await w.vm.$nextTick()
    expect(w.find('[data-testid="crop-apply"]').attributes('disabled')).toBeUndefined()
    await w.find('[data-testid="crop-apply"]').trigger('click')
    expect(w.emitted('apply')).toHaveLength(1)
  })
})
