import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MultiSelectToolbar from './MultiSelectToolbar.vue'

describe('MultiSelectToolbar layout menu', () => {
  const props = {
    selectedIds: ['a', 'b', 'c'],
    screenPosition: { x: 100, y: 80 },
  }

  it('opens layout modes and emits along_edges then grid', async () => {
    const wrapper = mount(MultiSelectToolbar, { props })
    const trigger = wrapper.findAll('button').find((b) => b.text().includes('整理布局'))
    expect(trigger).toBeTruthy()

    await trigger!.trigger('click')
    const along = wrapper.findAll('button').find((b) => b.text() === '顺着连线')
    const grid = wrapper.findAll('button').find((b) => b.text() === '自动网格')
    expect(along).toBeTruthy()
    expect(grid).toBeTruthy()

    await along!.trigger('click')
    expect(wrapper.emitted('layout')).toEqual([['along_edges']])

    await trigger!.trigger('click')
    const gridAgain = wrapper.findAll('button').find((b) => b.text() === '自动网格')
    await gridAgain!.trigger('click')
    expect(wrapper.emitted('layout')).toEqual([['along_edges'], ['grid']])
    wrapper.unmount()
  })
})

describe('MultiSelectToolbar: 生成 · N 按钮', () => {
  it('当 selectionBatch.runCount=0 时按钮禁用', () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 0, state: 'idle' },
      },
    })
    const btn = wrapper.find('[data-testid="selection-batch-generate"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('当 selectionBatch.runCount=3 时按钮文案 = "生成 · 3"', () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b', 'c'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 3, state: 'idle' },
      },
    })
    const btn = wrapper.find('[data-testid="selection-batch-generate"]')
    expect(btn.text()).toBe('生成 · 3')
  })

  it('点击按钮 emit generateSelection', async () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b', 'c'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 3, state: 'idle' },
      },
    })
    await wrapper.find('[data-testid="selection-batch-generate"]').trigger('click')
    expect(wrapper.emitted('generateSelection')).toBeTruthy()
  })
})

describe('MultiSelectToolbar: 重新生成 · M 按钮', () => {
  it('regenCount=2 时显示「重新生成 · 2」，点击 emit generateRegen', async () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 0, regenCount: 2, state: 'idle' },
      },
    })
    const gen = wrapper.find('[data-testid="selection-batch-generate"]')
    // 修订 A：runCount=0 且 regenCount>0 时不再显示「生成 · 0」
    expect(gen.exists()).toBe(false)
    const regen = wrapper.find('[data-testid="selection-batch-regenerate"]')
    expect(regen.exists()).toBe(true)
    expect(regen.text()).toBe('重新生成 · 2')
    await regen.trigger('click')
    expect(wrapper.emitted('generateRegen')).toBeTruthy()
  })

  it('混合选区：生成与重新生成两按钮并存', () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b', 'c'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 1, regenCount: 2, state: 'idle' },
      },
    })
    expect(wrapper.find('[data-testid="selection-batch-generate"]').text()).toBe('生成 · 1')
    expect(wrapper.find('[data-testid="selection-batch-regenerate"]').text()).toBe('重新生成 · 2')
  })

  it('无 regenCount（旧调用方）时不显示重新生成按钮，生成·0 仍禁用（兼容旧行为）', () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 0, state: 'idle' },
      },
    })
    expect(wrapper.find('[data-testid="selection-batch-regenerate"]').exists()).toBe(false)
    const btn = wrapper.find('[data-testid="selection-batch-generate"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('批量运行中重新生成按钮切换为「停止全部」且可点击（修复原停止不可达）', async () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 0, regenCount: 2, state: 'running' },
      },
    })
    const regen = wrapper.find('[data-testid="selection-batch-regenerate"]')
    expect(regen.text()).toBe('停止全部')
    expect(regen.attributes('disabled')).toBeUndefined()
    await regen.trigger('click')
    expect(wrapper.emitted('stopSelection')).toBeTruthy()
  })
})

describe('MultiSelectToolbar: 阻断态提示（pending_confirm / 超上限）', () => {
  it('pending_confirm 阻断时显示「待确认 · 2」，点击 emit blockedHint', async () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: {
          runCount: 0, regenCount: 0, state: 'idle',
          blocked: 'pending_confirm', blockedCount: 2,
        },
      },
    })
    expect(wrapper.find('[data-testid="selection-batch-generate"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="selection-batch-regenerate"]').exists()).toBe(false)
    const btn = wrapper.find('[data-testid="selection-batch-blocked"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('待确认 · 2')
    await btn.trigger('click')
    expect(wrapper.emitted('blockedHint')).toEqual([['pending_confirm']])
  })

  it('limit_24 阻断时显示「超上限 · 25」按钮', () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: Array.from({ length: 25 }, (_, i) => `n-${i}`),
        screenPosition: { x: 0, y: 0 },
        selectionBatch: {
          runCount: 0, regenCount: 0, state: 'idle',
          blocked: 'limit_24', blockedCount: 25,
        },
      },
    })
    const btn = wrapper.find('[data-testid="selection-batch-blocked"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('超上限 · 25')
  })
})
