import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RefineCanvasBack from './RefineCanvasBack.vue'

describe('RefineCanvasBack', () => {
  it('只留 ← 图标（follow-up #1），文字收进 title / aria-label，仍是唯一保留的画布级控件', () => {
    const w = mount(RefineCanvasBack)
    const btn = w.find('[data-testid="refine-canvas-back"]')
    expect(btn.exists()).toBe(true)
    expect(w.text()).not.toContain('返回画布')
    expect(btn.attributes('aria-label')).toBe('返回画布')
    expect(btn.attributes('title')).toBe('返回画布')
  })

  it('可点时 emit back', async () => {
    const w = mount(RefineCanvasBack)
    await w.find('[data-testid="refine-canvas-back"]').trigger('click')
    expect(w.emitted('back')).toHaveLength(1)
  })

  it('disabled 时按钮禁用且不 emit（防误杀正在跑的生成）', async () => {
    const w = mount(RefineCanvasBack, { props: { disabled: true } })
    const btn = w.find('[data-testid="refine-canvas-back"]')
    expect(btn.attributes('disabled')).toBeDefined()
    await btn.trigger('click')
    expect(w.emitted('back')).toBeUndefined()
  })
})
