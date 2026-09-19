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
