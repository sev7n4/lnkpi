import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import GridSliceWorkbench from './GridSliceWorkbench.vue'

function mountBench(props: Record<string, unknown>): VueWrapper {
  return mount(GridSliceWorkbench, { props: props as never, attachTo: document.body })
}

function bodyButtons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll('button')]
}

describe('GridSliceWorkbench', () => {
  const baseProps = {
    url: 'https://cdn.example.com/board.png',
    imageWidth: 1200,
    imageHeight: 800,
  }

  it('defaults to 3×3 preview and confirm payload', async () => {
    const wrapper = mountBench(baseProps)

    expect(wrapper.findAll('[data-cell-index]')).toHaveLength(9)
    ;(document.body.querySelector('button.grid-slice-dock__primary') as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('confirm')).toEqual([[{ cols: 3, rows: 3 }]])
    wrapper.unmount()
  })

  it('updates preview on preset and 应用划分', async () => {
    const wrapper = mountBench(baseProps)

    const twoByTwo = bodyButtons().find((b) => b.textContent === '2×2')
    expect(twoByTwo).toBeTruthy()
    twoByTwo!.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[data-cell-index]')).toHaveLength(4)

    const inputs = [...document.body.querySelectorAll('input[type="number"]')] as HTMLInputElement[]
    inputs[0].value = '2'
    inputs[0].dispatchEvent(new Event('input'))
    inputs[1].value = '4'
    inputs[1].dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()
    const apply = bodyButtons().find((b) => (b.textContent ?? '').includes('应用划分'))
    apply!.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[data-cell-index]')).toHaveLength(8)
    expect(document.body.querySelector('button.grid-slice-dock__primary')?.textContent).toContain(
      '裁剪 8 张',
    )
    wrapper.unmount()
  })

  it('emits close on 取消 and Escape, without mask/version UI', async () => {
    const wrapper = mountBench(baseProps)

    expect(document.body.textContent ?? '').not.toMatch(/画笔|蒙版|版本条|对照/)

    const cancel = bodyButtons().find((b) => (b.textContent ?? '').includes('取消'))
    expect(cancel).toBeTruthy()
    cancel!.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')?.length).toBeGreaterThanOrEqual(1)
    wrapper.unmount()
  })
})
