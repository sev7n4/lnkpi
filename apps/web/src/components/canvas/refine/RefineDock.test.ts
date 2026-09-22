import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  IMAGE2_EDIT_SIZES,
  IMAGE_EDIT_GATEWAY_MODEL_ID,
  IMAGE_EDIT_MODEL_KEYS,
  IMAGE_EDIT_MODEL_PRICING,
  P1_IMAGE_EDIT_MODEL_KEY,
} from '@lnkpi/shared'
import RefineDock from './RefineDock.vue'

const mountDock = (props: Record<string, unknown> = {}) =>
  mount(RefineDock, {
    props: {
      prompt: '',
      credits: 10,
      beforeUrl: 'blob:before',
      modelKey: P1_IMAGE_EDIT_MODEL_KEY,
      availableModelKeys: IMAGE_EDIT_MODEL_KEYS,
      sizes: IMAGE2_EDIT_SIZES,
      sizeOverride: 'auto',
      mode: 'edit',
      width: 1280,
      height: 720,
      ...props,
    },
    global: { stubs: { GuidePickerPopover: { template: '<div class="guide-picker-stub" />' } } },
  })

describe('RefineDock', () => {
  it('与图片节点 dock 同构：header 类型图标 + 「精修」 + 关闭', () => {
    const w = mountDock()
    expect(w.find('.bottom-toolbar-container').exists()).toBe(true)
    expect(w.find('.bottom-toolbar-type-icon').exists()).toBe(true)
    expect(w.text()).toContain('精修')
    expect(w.find('.bottom-toolbar-close').exists()).toBe(true)
  })

  it('参考条只有原图一个 chip，且不给上传入口（精修通道暂不接受参考图）', () => {
    const strip = mountDock().findComponent({ name: 'DockRefStrip' })
    expect(strip.exists()).toBe(true)
    expect((strip.props('refs') as unknown[]).length).toBe(1)
    expect(strip.props('showAddUpload')).toBeFalsy()
  })

  it('模型是受控选择器，渲染白名单项（本期仅 image2）', async () => {
    const w = mountDock()
    expect(w.find('[data-testid="dock-model-select"]').exists()).toBe(true)
    await w.find('[data-testid="dock-model-select"]').trigger('click')
    const options = w.findAll('[data-testid="dock-model-option"]')
    expect(options.map((o) => o.attributes('data-model-key'))).toEqual([...IMAGE_EDIT_MODEL_KEYS])
    expect(w.find('[data-testid="dock-model-option"][data-model-key="image2"]').text()).toContain(
      IMAGE_EDIT_GATEWAY_MODEL_ID,
    )
  })

  it('切模型 emit update:modelKey', async () => {
    const w = mountDock()
    await w.find('[data-testid="dock-model-select"]').trigger('click')
    await w.find('[data-testid="dock-model-option"][data-model-key="image2"]').trigger('click')
    expect(w.emitted('update:modelKey')).toEqual([['image2']])
  })

  it('尺寸是受控选择器，列 auto + IMAGE2_EDIT_SIZES', async () => {
    const w = mountDock()
    await w.find('[data-testid="dock-size-select"]').trigger('click')
    const options = w.findAll('[data-testid="dock-size-option"]')
    const expected = Array.from(new Set(['auto', ...IMAGE2_EDIT_SIZES]))
    expect(options.map((o) => o.attributes('data-size'))).toEqual(expected)
    expect(options.find((o) => o.attributes('data-size') === 'auto')).toBeTruthy()
  })

  it('切尺寸 emit update:sizeOverride', async () => {
    const w = mountDock({ sizes: ['auto', '1024x1024'], sizeOverride: 'auto' })
    await w.find('[data-testid="dock-size-select"]').trigger('click')
    await w.find('[data-testid="dock-size-option"][data-size="1024x1024"]').trigger('click')
    expect(w.emitted('update:sizeOverride')).toEqual([['1024x1024']])
  })

  it('扩图模式下隐藏尺寸选择器（仅留 mode 感知钩子）', () => {
    const w = mountDock({ mode: 'outpaint' })
    expect(w.find('[data-testid="dock-size-select"]').exists()).toBe(false)
  })

  it('credits 按 shared 定价表动态显示（image2 = 10）', () => {
    const w = mountDock({ modelKey: 'image2' })
    expect(w.findComponent({ name: 'DockCreditBadge' }).props('credits')).toBe(
      IMAGE_EDIT_MODEL_PRICING['image2'],
    )
  })

  it('提示词区双向绑定，回车 submit 触发 run', () => {
    const w = mountDock()
    const section = w.findComponent({ name: 'DockPromptSection' })
    section.vm.$emit('update:modelValue', '把背景换成雪山')
    expect(w.emitted('update:prompt')).toEqual([['把背景换成雪山']])
    section.vm.$emit('submit')
    expect(w.emitted('run')).toHaveLength(1)
  })

  it('精修按钮：可点时 emit run，busy 时禁用', async () => {
    const w = mountDock({ prompt: 'x' })
    await w.find('[data-testid="dock-run"]').trigger('click')
    expect(w.emitted('run')).toHaveLength(1)
    expect(mountDock({ prompt: 'x', busy: true }).find('[data-testid="dock-run"]').attributes('disabled')).toBeDefined()
  })

  it('应用到节点只在 canApply 时出现', () => {
    expect(mountDock({ canApply: false }).find('[data-testid="dock-apply"]').exists()).toBe(false)
    expect(mountDock({ canApply: true }).find('[data-testid="dock-apply"]').exists()).toBe(true)
  })

  it('编辑意图挂在 header-end（与图片节点 dock 的「场景模板」同位）', () => {
    const w = mountDock()
    expect(w.find('.bottom-toolbar-header-end [data-testid="dock-edit-intent"]').exists()).toBe(true)
  })

  it('选区为空时提示先圈选', () => {
    expect(mountDock({ coverageKind: 'empty' }).text()).toContain('请先圈选要改的区域')
  })

  it('有错误时显示错误并可重试', async () => {
    const w = mountDock({ errorMessage: '精修失败，请重试' })
    expect(w.text()).toContain('精修失败，请重试')
    await w.find('.refine-dock__retry').trigger('click')
    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('关闭按钮 emit close', async () => {
    const w = mountDock()
    await w.find('.bottom-toolbar-close').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})

describe('RefineDock 扩图模式（Q3 衔接：CTA 语义与引导）', () => {
  it('扩图模式下主按钮文案为「扩图生成」（不再沿用「精修」）', () => {
    const w = mountDock({ mode: 'outpaint' })
    expect(w.find('[data-testid="dock-run"]').text()).toBe('扩图生成')
  })

  it('已产生扩出时不显示引导文案', () => {
    const w = mountDock({ mode: 'outpaint', outpaintReady: true })
    expect(w.find('[data-testid="dock-outpaint-hint"]').exists()).toBe(false)
  })

  it('尚未扩出时显示「先拖动手柄」引导文案', () => {
    const w = mountDock({ mode: 'outpaint', outpaintReady: false })
    expect(w.find('[data-testid="dock-outpaint-hint"]').text()).toContain('先拖动')
  })

  it('普通精修模式不受 outpaintReady 影响', () => {
    const w = mountDock({ mode: 'edit', outpaintReady: false })
    expect(w.find('[data-testid="dock-run"]').text()).toBe('精修')
    expect(w.find('[data-testid="dock-outpaint-hint"]').exists()).toBe(false)
  })
})
