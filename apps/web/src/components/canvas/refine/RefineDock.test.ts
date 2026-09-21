import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { IMAGE_EDIT_GATEWAY_MODEL_ID } from '@lnkpi/shared'
import RefineDock from './RefineDock.vue'

const mountDock = (props: Record<string, unknown> = {}) =>
  mount(RefineDock, {
    props: { prompt: '', credits: 10, beforeUrl: 'blob:before', modelLabel: IMAGE_EDIT_GATEWAY_MODEL_ID, width: 1280, height: 720, ...props },
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

  it('模型与尺寸是只读状态位，不是可点控件', () => {
    const w = mountDock()
    expect(w.find('[data-testid="dock-model-chip"]').text()).toContain(IMAGE_EDIT_GATEWAY_MODEL_ID)
    expect(w.find('[data-testid="dock-size-chip"]').text()).toContain('1280×720')
    expect(w.find('[data-testid="dock-size-chip"]').element.tagName).not.toBe('BUTTON')
  })

  it('尺寸位带比例（由宽高推出）', () => {
    expect(mountDock({ width: 1920, height: 1080 }).find('[data-testid="dock-size-chip"]').text()).toContain('16:9')
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
