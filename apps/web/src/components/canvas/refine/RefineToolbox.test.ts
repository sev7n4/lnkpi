import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RefineToolbox from './RefineToolbox.vue'

const mountBox = (props: Record<string, unknown> = {}) =>
  mount(RefineToolbox, { props: { versions: [], ...props } })

describe('RefineToolbox', () => {
  it('两组标题：快速预设 + 版本历史，自己是唯一滚动区', () => {
    const w = mountBox()
    expect(w.find('[data-testid="refine-toolbox"]').exists()).toBe(true)
    expect(w.text()).toContain('快速预设')
    expect(w.text()).toContain('版本历史')
    const scroll = w.find('[data-testid="toolbox-scroll"]')
    expect(scroll.exists()).toBe(true)
    expect(scroll.classes()).toContain('refine-toolbox__scroll')
  })

  it('「清除瑕疵」点击后 emit applyStainPreset', async () => {
    const w = mountBox()
    await w.find('[data-testid="toolbox-preset-stain"]').trigger('click')
    expect(w.emitted('applyStainPreset')).toHaveLength(1)
  })

  it('busy 时「清除瑕疵」禁用', () => {
    expect(mountBox({ busy: true }).find('[data-testid="toolbox-preset-stain"]').attributes('disabled')).toBeDefined()
  })

  it('版本历史把 select / revert 透传上来', () => {
    const w = mountBox({ versions: [{ id: 'v1', url: 'blob:v1' }], currentVersionId: 'v1' })
    const strip = w.findComponent({ name: 'VersionStrip' })
    expect(strip.exists()).toBe(true)
    // R15: VersionStrip 的真实契约是 revert: [payload: { versionId: string }]，
    // 测试必须伪造真实形状，否则会掩护「对象当 id 透传」的 bug。
    strip.vm.$emit('select', 'v1')
    strip.vm.$emit('revert', { versionId: 'v1' })
    expect(w.emitted('selectVersion')).toEqual([['v1']])
    expect(w.emitted('revertVersion')).toEqual([['v1']])
  })

  it('不预置任何空的能力组标题（M2 工具到位时再加）', () => {
    const text = mountBox().text()
    for (const label of ['抠素材', '构图', '改内容', '提画质']) expect(text).not.toContain(label)
  })
})
