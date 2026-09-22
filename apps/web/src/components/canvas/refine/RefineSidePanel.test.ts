import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { IMAGE_EDIT_GATEWAY_MODEL_ID } from '@lnkpi/shared'
import { studioApi } from '@/services/studio-api'
import { persistMediaUrl } from '@/composables/useMediaUpload'
import { useCanvasEditorStore } from '@/stores/canvasEditor'
import { ElMessage } from 'element-plus'
import { OUTPAINT_FALLBACK_PROMPT } from './outpaintFallback'
import RefineSidePanel from './RefineSidePanel.vue'

vi.mock('@/services/studio-api', () => ({
  studioApi: {
    editImage: vi.fn(async () => ({ data: { data: { url: 'blob:after', id: 'rec1' } } })),
    segmentImage: vi.fn(async () => ({ data: { data: { maskUrl: 'blob:mask' } } })),
    mattingImage: vi.fn(async () => ({ data: { data: { url: 'blob:mat' } } })),
  },
}))

vi.mock('@/composables/useMediaUpload', () => ({
  persistMediaUrl: vi.fn(async () => 'https://up/mask.png'),
}))

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { warning: vi.fn(), error: vi.fn() } }
})

vi.mock('./outpaintRender', () => ({
  renderOutpaintPngs: vi.fn(async () => ({
    baseBlob: new Blob(['base'], { type: 'image/png' }),
    maskBlob: new Blob(['mask'], { type: 'image/png' }),
  })),
}))

const baseProps = {
  nodeId: 'n1', beforeUrl: 'blob:before', sessionId: 's1',
  panelWidth: 400, collapsed: false, isNarrow: false, insetRight: 400,
}

// R8 — 简报里 mount 的 global.plugins 与 beforeEach 各造一个 pinia（两个实例）是计划缺陷，
// 统一为「每个用例共用一个 pinia」：beforeEach 创建并 setActivePinia，mount 复用同一个实例。
let pinia: Pinia
let current: VueWrapper | null = null

// 组件正文包在 <Teleport to="body"> 里，teleport 内容会渲染到 document.body、
// 脱离 wrapper 子树，w.find / w.element 查不到。沿用本仓库测试约定（AgentAssetPicker.test.ts）
// 不 stub Teleport，改查 document.body。断言与 testid 与原简报逐字一致。
const mountPanel = (overrides: Record<string, unknown> = {}) => {
  current = mount(RefineSidePanel, {
    props: { ...baseProps, ...overrides },
    attachTo: document.body,
    global: {
      plugins: [pinia],
      stubs: {
        // Teleport 改为就地渲染，避免节点逃逸到 body 后无法随 unmount 清理（导致跨测试用例串味）。
        Teleport: { template: '<div><slot /></div>' },
        GuidePickerPopover: { template: '<div />' },
      },
    },
  })
  return current
}

const q = (sel: string) => document.body.querySelector(sel)
const qa = (sel: string) => Array.from(document.body.querySelectorAll(sel))

// 扩图提交 / 守卫一律走悬浮 dock 的 CTA（refine-select 的 panel 落点 dock 仍用 dock-run）。
const runOutpaintButton = () => q('[data-testid="outpaint-dock-cta"]') as HTMLButtonElement | null

describe('RefineSidePanel 三段式', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    // jsdom 未实现 URL.createObjectURL，runRefine 依赖它生成 fallbackUrl。
    if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:fallback')
    if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    current?.unmount()
    current = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('段落顺序：head → 对照带 → 当前工具面板 → 会话胶片条 → dock（§5 骨架）', () => {
    mountPanel()
    const order = qa(
      '.refine-side__head, [data-testid="refine-compare-band"], [data-testid="workbench-panel-scroll"], [data-testid="session-filmstrip"], [data-testid="refine-dock"]',
    ).map((el) => {
      const tid = el.getAttribute('data-testid')
      if (el.classList.contains('refine-side__head')) return 'head'
      if (tid === 'workbench-panel-scroll') return 'panel-scroll'
      return (tid ?? '').replace('refine-', '')
    })
    expect(order).toEqual(['head', 'compare-band', 'panel-scroll', 'session-filmstrip', 'dock'])
  })

  it('右栏不再有 Toolbox，滚动槽按注册表渲染当前工具面板', () => {
    mountPanel()
    expect(q('[data-testid="refine-toolbox"]')).toBeNull()
    expect(qa('[data-testid="workbench-panel-scroll"]').length).toBe(1)
    expect(q('[data-testid="refine-select-panel"]')).not.toBeNull()
  })

  it('不再有旧的三排图标工具条', () => {
    mountPanel()
    expect(q('.refine-side__toolbar')).toBeNull()
    expect(q('[title="点选主体"]')).toBeNull()
    expect(q('[title="魔棒"]')).toBeNull()
  })

  it('不再有对照模式按钮 / 放大镜 / 细节放大', () => {
    mountPanel()
    expect(q('[title="左右对照"]')).toBeNull()
    expect(q('[title="重叠滑竿"]')).toBeNull()
    expect(q('[title="放大镜"]')).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('细节放大')
  })

  it('收起态：只剩头部，对照带与 dock 都不渲染', () => {
    mountPanel({ collapsed: true, insetRight: 44 })
    const side = q('.refine-side')
    expect(side).not.toBeNull()
    expect(side!.classList.contains('is-collapsed')).toBe(true)
    expect(q('[data-testid="refine-compare-band"]')).toBeNull()
    expect(q('[data-testid="refine-toolbox"]')).toBeNull()
    expect(q('[data-testid="refine-dock"]')).toBeNull()
  })

  it('右栏头部的收起钮仍在', () => {
    mountPanel()
    expect(q('.refine-side__collapse')).not.toBeNull()
  })

  it('扩图模式：滚动槽渲染 OutpaintPanel，dock 走悬浮（floatingAvailable=true）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    // 显示门控：产生真实扩出后悬浮 dock 才出现（2026-09-22 用户验收修订）
    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 600, height: 300 })
    mountPanel({ floatingAvailable: true })
    await flushPromises()
    expect(q('[data-testid="outpaint-panel"]')).not.toBeNull()
    expect(q('[data-testid="outpaint-dock-floating"]')).not.toBeNull()
    // 两个扩图落点互斥：悬浮可用时只有悬浮 dock（面板兜底不渲染）。
    expect(qa('[data-testid="outpaint-dock"]').length).toBe(1)
  })

  it('扩图门控：尚无真实扩出时悬浮 dock 不渲染（常驻会挡画布拖拽）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 400, height: 300 })
    mountPanel({ floatingAvailable: true })
    await flushPromises()
    expect(q('[data-testid="outpaint-dock-floating"]')).toBeNull()
    // 一旦产生扩出即出现
    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 500, height: 300 })
    await flushPromises()
    expect(q('[data-testid="outpaint-dock-floating"]')).not.toBeNull()
  })

  it('扩图门控：手柄拖拽进行中悬浮 dock 隐藏（不挡拖拽），松手恢复', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 600, height: 300 })
    mountPanel({ floatingAvailable: true })
    await flushPromises()
    expect(q('[data-testid="outpaint-dock-floating"]')).not.toBeNull()
    editor.setRefineOutpaintDragging(true)
    await flushPromises()
    expect(q('[data-testid="outpaint-dock-floating"]')).toBeNull()
    editor.setRefineOutpaintDragging(false)
    await flushPromises()
    expect(q('[data-testid="outpaint-dock-floating"]')).not.toBeNull()
  })

  it('窄屏：扩图 dock 退化为面板底部（不渲染悬浮层）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    mountPanel({ floatingAvailable: false })
    await flushPromises()
    expect(q('[data-testid="outpaint-dock-floating"]')).toBeNull()
    expect(q('[data-testid="outpaint-dock"]')).not.toBeNull()
    // panel 落点 CTA 是 32px 档（§4.3：md 32）
    expect(q('.outpaint-dock [class*="dock-generate-btn--md"]')).not.toBeNull()
    // 两个扩图落点互斥：窄屏只有面板底部 dock（悬浮层不渲染）。
    expect(qa('[data-testid="outpaint-dock"]').length).toBe(1)
  })

  it('§4.3 布局铁律：dock 不嵌在滚动区内部（两者是 flex 兄弟，dock 在其后）', () => {
    mountPanel()
    const scroll = q('[data-testid="workbench-panel-scroll"]')!
    expect(scroll.querySelector('[data-testid="refine-dock"]')).toBeNull()
    expect(q('.refine-side__filmstrip')).not.toBeNull()
  })

  it('§4.3 高度预算：滚动槽无内联高度（像素预算 ≤148 / ≤224 由目视验收把关）', () => {
    mountPanel()
    expect(q('[data-testid="workbench-panel-scroll"]')!.getAttribute('style')).toBeNull()
  })

  it('模型选择器渲染精修通道真实模型（来自 shared，不写死）', async () => {
    mountPanel()
    const trigger = q('[data-testid="dock-model-select"]')
    expect(trigger).not.toBeNull()
    trigger!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flushPromises()
    const opt = q('[data-testid="dock-model-option"][data-model-key="image2"]')
    expect(opt).not.toBeNull()
    expect(opt!.textContent).toContain(IMAGE_EDIT_GATEWAY_MODEL_ID)
  })

  it('runRefine 请求体带 model / size / mode（按 shared 白名单与定价）', async () => {
    const editor = useCanvasEditorStore()
    editor.refineCoverage = 0.5
    editor.registerRefineMask({
      exportPng: async () => new Blob(['x'], { type: 'image/png' }),
      clear: () => {},
      getCanvas: () => document.createElement('canvas'),
      invert: () => {},
    })
    mountPanel()
    const runBtn = q('[data-testid="dock-run"]')
    expect(runBtn).not.toBeNull()
    await runBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flushPromises()
    const call = (studioApi.editImage as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call).toBeTruthy()
    const body = call[0]
    expect(body.model).toBe('image2')
    expect(body.size).toBe('auto')
    expect(body.mode).toBe('edit')
    // 结果进入会话胶片条（afterUrl 由 store 当前结果派生）
    expect(editor.refineSessionResults.length).toBe(1)
  })

  it('扩图提交：合成两张 PNG persist 后走 editImage（mode:outpaint / size:auto / outpaintFrom·To）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 800, height: 600 })
    mountPanel()
    const runBtn = runOutpaintButton()
    expect(runBtn).not.toBeNull()
    await runBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 1))
    await flushPromises()

    const persist = (persistMediaUrl as ReturnType<typeof vi.fn>)
    expect(persist).toHaveBeenCalledTimes(2)
    const call = (studioApi.editImage as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call).toBeTruthy()
    const body = call[0]
    expect(body.mode).toBe('outpaint')
    expect(body.size).toBe('auto')
    expect(body.imageUrl).toBe('https://up/mask.png')
    expect(body.maskUrl).toBe('https://up/mask.png')
    expect(body.outpaintFrom).toEqual({ width: 400, height: 300 })
    expect(body.outpaintTo).toEqual({ width: 800, height: 600 })
    // 结果进入会话胶片条
    expect(editor.refineSessionResults.length).toBe(1)
  })

  it('扩图空 prompt 时请求体 prompt=兜底英文', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 800, height: 600 })
    mountPanel()
    const runBtn = runOutpaintButton()
    await runBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 1))
    await flushPromises()

    const call = (studioApi.editImage as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call).toBeTruthy()
    expect(call[0].prompt).toBe(OUTPAINT_FALLBACK_PROMPT)
  })

  it('扩图模式下 dock 尺寸选择器隐藏（mode 钩子）', async () => {
    const editor = useCanvasEditorStore()
    editor.refineMode = 'outpaint'
    mountPanel()
    expect(q('[data-testid="dock-size-select"]')).toBeNull()
    editor.refineMode = 'select'
    await flushPromises()
    expect(q('[data-testid="dock-size-select"]')).not.toBeNull()
  })

  it('扩图成功后：对照带进入基准画布模式（Before 居中贴图 + 扩出区斜纹占位）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 100, y: 50, width: 800, height: 600 })
    mountPanel()
    const runBtn = runOutpaintButton()
    await runBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 1))
    await flushPromises()

    // 对照带以扩图元数据消费（T2 契约 editMode/outpaintFrom/outpaintTo），CompareView 渲染基准画布
    const stage = q('[data-testid="compare-base-stage"]')
    expect(stage).not.toBeNull()
    expect(stage!.getAttribute('style')).toContain('800')
    expect(stage!.getAttribute('style')).toContain('600')
    expect(q('[data-testid="compare-base-hatch"]')).not.toBeNull()
  })

  it('普通精修成功后：对照带不进入基准画布模式', async () => {
    const editor = useCanvasEditorStore()
    editor.refineCoverage = 0.5
    editor.registerRefineMask({
      exportPng: async () => new Blob(['x'], { type: 'image/png' }),
      clear: () => {},
      getCanvas: () => document.createElement('canvas'),
      invert: () => {},
    })
    mountPanel()
    const runBtn = q('[data-testid="dock-run"]')
    await runBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(q('[data-testid="compare-base-stage"]')).toBeNull()
    expect(q('[data-testid="compare-base-hatch"]')).toBeNull()
  })

  it('扩图会话结果应用：apply payload 携带 metadata.outpaintTo（含落像素，CanvasPage 据此 contain-fit 出 nodeSize）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 0.4, y: 50.6, width: 400.2, height: 400.9 })
    mountPanel()
    await flushPromises()
    await runOutpaintButton()!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 1))
    await flushPromises()

    // 扩图结果入会话时快照了对照元数据（editMode / outpaintFrom / outpaintTo）
    expect(editor.refineSessionResults[0]!.metadata).toEqual({
      editMode: 'outpaint',
      outpaintFrom: { width: 400, height: 300 },
      outpaintTo: { width: 400, height: 400 },
    })

    const applyBtn = q('[data-testid="outpaint-dock-apply"]') as HTMLButtonElement | null
    expect(applyBtn).not.toBeNull()
    await applyBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flushPromises()

    const applies = current?.emitted('apply')
    expect(applies).toBeTruthy()
    const payload = (applies as unknown[][]).at(-1)![0] as {
      url: string
      metadata?: { editMode?: string; outpaintFrom?: { width: number; height: number }; outpaintTo?: { width: number; height: number } }
    }
    expect(payload.url).toBe('blob:after')
    expect(payload.metadata).toEqual({
      editMode: 'outpaint',
      outpaintFrom: { width: 400, height: 300 },
      outpaintTo: { width: 400, height: 400 },
    })
  })

  it('扩图提交的 outpaintTo 使用落像素后的 rect（不含小数）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 0.4, y: 50.6, width: 400.2, height: 400.9 })
    mountPanel()
    await flushPromises()
    runOutpaintButton()!.click()
    await flushPromises()
    const calls = (studioApi.editImage as unknown as { mock: { calls: [Record<string, unknown>][] } }).mock.calls
    expect(calls.at(-1)![0]!.outpaintTo).toEqual({ width: 400, height: 400 })
  })
})

describe('RefineSidePanel 扩图提交守卫（Q3：零扩展不得提交）', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:fallback')
    if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    current?.unmount()
    current = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('零扩展（rect == 原图）时 CTA 禁用并给引导文案；真实扩出后启用', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 400, height: 300 })
    mountPanel()
    await flushPromises()
    expect(runOutpaintButton()!.disabled).toBe(true)
    expect(q('[data-testid="outpaint-dock-guard"]')!.textContent).toContain('先拖动')

    editor.setRefineOutpaintRect({ x: 0, y: 100, width: 400, height: 400 })
    await flushPromises()
    expect(runOutpaintButton()!.disabled).toBe(false)
    expect(q('[data-testid="outpaint-dock-guard"]')).toBeNull()
    expect(runOutpaintButton()!.getAttribute('aria-label')).toBe('扩图生成')
  })

  it('仅向右/向下扩（x = y = 0）也算已扩出', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    mountPanel()
    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 500, height: 300 })
    await flushPromises()
    expect(runOutpaintButton()!.disabled).toBe(false)
  })
})

describe('RefineSidePanel matting 接线（Task 7）', () => {
  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:fallback')
    if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    current?.unmount()
    current = null
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('扩图生成成功后结果进会话胶片条且 after 切换', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('outpaint')
    editor.setRefineOutpaintBase({ width: 400, height: 300 })
    editor.setRefineOutpaintRect({ x: 0, y: 0, width: 800, height: 600 })
    mountPanel()
    const runBtn = runOutpaintButton()
    await runBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 1))
    await flushPromises()

    expect(editor.refineSessionResults.length).toBe(1)
    // afterUrl 由 store 当前结果派生
    expect(editor.refineSessionResults[0].url).toBe('blob:after')
    // 胶片条渲染出该项
    expect(q('[data-testid="filmstrip-item"]')).not.toBeNull()
  })

  it('matting 面板渲染 + run-auto 调 mattingImage + 结果入会话', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('matting')
    mountPanel()
    await flushPromises()
    expect(q('[data-testid="matting-panel"]')).not.toBeNull()

    const runAuto = q('[data-testid="matting-run-auto"]') as HTMLButtonElement | null
    expect(runAuto).not.toBeNull()
    await runAuto!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect((studioApi.mattingImage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
    expect((studioApi.mattingImage as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toEqual({
      imageUrl: 'blob:before',
    })
    expect(editor.refineSessionResults.length).toBe(1)
    expect(editor.refineSessionResults[0]!.url).toBe('blob:mat')
    expect(editor.refineSessionResults[0]!.prompt).toBe('抠图')
    expect(editor.currentRefineSessionResult?.url).toBe('blob:mat')
  })

  it('matting 503 时 toast 且不 push', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('matting')
    ;(studioApi.mattingImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      response: { status: 503 },
    })
    mountPanel()
    await flushPromises()
    const runAuto = q('[data-testid="matting-run-auto"]') as HTMLButtonElement | null
    await runAuto!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(ElMessage.warning).toHaveBeenCalledWith('抠图服务未启用')
    expect(editor.refineSessionResults.length).toBe(0)
  })

  it('不再渲染 VersionStrip、revert emit 移除', () => {
    mountPanel()
    expect(q('[data-testid="refine-version-strip"]')).toBeNull()
    expect(q('[data-testid="session-filmstrip"]')).not.toBeNull()
    // 当前没有 revert emit
    expect(current?.emitted('revert')).toBeFalsy()
  })

  it('胶片条点击切换 afterUrl（apply payload 跟随）', async () => {
    const editor = useCanvasEditorStore()
    editor.setRefineMode('matting')
    editor.pushRefineSessionResult({ url: 'blob:a', prompt: '抠图' })
    editor.pushRefineSessionResult({ url: 'blob:b', prompt: '选区抠图' })
    mountPanel()
    await flushPromises()

    const items = qa('[data-testid="filmstrip-item"]')
    expect(items.length).toBe(2)
    const secondId = editor.refineSessionResults[1]!.id
    const second = items.find((el) => el.getAttribute('data-id') === secondId) as HTMLButtonElement
    expect(second).toBeTruthy()
    await second.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(editor.refineSessionCurrentId).toBe(secondId)
    expect(editor.currentRefineSessionResult?.url).toBe('blob:b')

    const applyBtn = q('[data-testid="matting-apply"]') as HTMLButtonElement | null
    expect(applyBtn).not.toBeNull()
    await applyBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await flushPromises()

    const applies = current?.emitted('apply')
    expect(applies).toBeTruthy()
    // emitted('apply') 形如 [[payload], ...]：每个元素是当次 emit 的参数数组。
    const payload = (applies as unknown[][]).at(-1)![0] as {
      url: string
      prompt: string
      recordId?: string
    }
    expect(payload.url).toBe('blob:b')
    expect(payload.prompt).toBe('选区抠图')
  })
})
