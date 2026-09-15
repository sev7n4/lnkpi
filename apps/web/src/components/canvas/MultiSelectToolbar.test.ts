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
