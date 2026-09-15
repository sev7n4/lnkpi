import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GridSliceWorkViewport from './GridSliceWorkViewport.vue'

describe('GridSliceWorkViewport', () => {
  it('renders contain image, cell indices 1…N, and 共 N 格 footer', () => {
    const wrapper = mount(GridSliceWorkViewport, {
      props: {
        url: 'https://cdn.example.com/board.png',
        width: 900,
        height: 600,
        cols: 3,
        rows: 3,
        insetRight: 400,
      },
    })

    const img = wrapper.get('img')
    expect(img.attributes('src')).toBe('https://cdn.example.com/board.png')
    expect(wrapper.findAll('[data-cell-index]').map((el) => el.text())).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
    ])
    expect(wrapper.text()).toContain('共 9 格')
    expect((wrapper.element as HTMLElement).style.right).toBe('400px')
    wrapper.unmount()
  })

  it('updates overlay when cols/rows change to 2×4', async () => {
    const wrapper = mount(GridSliceWorkViewport, {
      props: {
        url: 'https://cdn.example.com/board.png',
        cols: 3,
        rows: 3,
        insetRight: 44,
      },
    })

    await wrapper.setProps({ cols: 2, rows: 4 })
    expect(wrapper.findAll('[data-cell-index]').map((el) => el.text())).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ])
    expect(wrapper.text()).toContain('共 8 格')
    wrapper.unmount()
  })
})
