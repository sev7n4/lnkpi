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
    const trigger = wrapper.findAll('button').find((b) => b.attributes('aria-label') === '整理布局')
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

describe('MultiSelectToolbar: 图标化', () => {
  it('所有动作按钮均为图标（内含 svg）+ aria-label，不再使用纯文字', () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b', 'c'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 2, regenCount: 1, state: 'idle' },
      },
    })
    const gen = wrapper.find('[data-testid="selection-batch-generate"]')
    expect(gen.find('svg').exists()).toBe(true)
    expect(gen.attributes('aria-label')).toBe('批量生成 2 个节点')
    // 角标数字
    expect(gen.text()).toContain('2')
  })

  it('运行中按钮切换为停止图标', () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 2, regenCount: 0, state: 'running' },
      },
    })
    const gen = wrapper.find('[data-testid="selection-batch-generate"]')
    expect(gen.attributes('aria-label')).toBe('停止全部')
    expect(gen.attributes('disabled')).toBeUndefined()
  })
})

describe('MultiSelectToolbar: 生成 · N 按钮', () => {
  it('当 selectionBatch.runCount=0 且无其他态时按钮禁用', () => {
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

  it('runCount=3 时角标显示 3，点击 emit generateSelection', async () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b', 'c'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 3, state: 'idle' },
      },
    })
    const btn = wrapper.find('[data-testid="selection-batch-generate"]')
    expect(btn.text()).toContain('3')
    await btn.trigger('click')
    expect(wrapper.emitted('generateSelection')).toBeTruthy()
  })
})

describe('MultiSelectToolbar: 重新生成 · M 按钮', () => {
  it('regenCount=2 时只显示重新生成图标按钮（角标 2），点击 emit generateRegen', async () => {
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
    expect(regen.attributes('aria-label')).toContain('重新生成')
    expect(regen.text()).toContain('2')
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
    expect(wrapper.find('[data-testid="selection-batch-generate"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="selection-batch-regenerate"]').exists()).toBe(true)
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

  it('批量运行中重新生成按钮切换为停止且可点击（修复原停止不可达）', async () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 0, regenCount: 2, state: 'running' },
      },
    })
    const regen = wrapper.find('[data-testid="selection-batch-regenerate"]')
    expect(regen.attributes('aria-label')).toBe('停止全部')
    expect(regen.attributes('disabled')).toBeUndefined()
    await regen.trigger('click')
    expect(wrapper.emitted('stopSelection')).toBeTruthy()
  })
})

describe('MultiSelectToolbar: 阻断态提示（pending_confirm / 超上限）', () => {
  it('pending_confirm 阻断时显示待确认图标（角标 2），点击 emit blockedHint', async () => {
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
    expect(btn.attributes('aria-label')).toContain('待确认')
    expect(btn.text()).toContain('2')
    await btn.trigger('click')
    expect(wrapper.emitted('blockedHint')).toEqual([['pending_confirm']])
  })

  it('limit_24 阻断时显示超上限图标按钮（角标 25）', () => {
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
    expect(btn.attributes('aria-label')).toContain('上限')
    expect(btn.text()).toContain('25')
  })
})

describe('MultiSelectToolbar: 缺提示词态', () => {
  it('纯缺提示词选区：显示缺提示词图标（角标 N），点击 emit blockedHint missing_prompt', async () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: {
          runCount: 0, regenCount: 0, state: 'idle',
          missingCount: 3,
        },
      },
    })
    const btn = wrapper.find('[data-testid="selection-batch-missing-prompt"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('aria-label')).toContain('未写提示词')
    expect(btn.text()).toContain('3')
    // 不再显示令人困惑的禁用「生成 · 0」
    expect(wrapper.find('[data-testid="selection-batch-generate"]').exists()).toBe(false)
    await btn.trigger('click')
    expect(wrapper.emitted('blockedHint')).toEqual([['missing_prompt']])
  })

  it('runCount>0 时缺提示词按钮不出现（缺提示词节点已由 toast 点名）', () => {
    const wrapper = mount(MultiSelectToolbar, {
      props: {
        selectedIds: ['a', 'b', 'c'],
        screenPosition: { x: 0, y: 0 },
        selectionBatch: { runCount: 2, regenCount: 0, state: 'idle', missingCount: 1 },
      },
    })
    expect(wrapper.find('[data-testid="selection-batch-missing-prompt"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="selection-batch-generate"]').exists()).toBe(true)
  })
})
