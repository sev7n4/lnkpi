import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import GridSliceSidePanel from './GridSliceSidePanel.vue'

function mountPanel(props: Record<string, unknown>): VueWrapper {
  return mount(GridSliceSidePanel, { props: props as never, attachTo: document.body })
}

function bodyText(): string {
  return document.body.textContent ?? ''
}

function bodyButtons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll('button')]
}

describe('GridSliceSidePanel', () => {
  it('shows 宫格裁剪 title with WxH and 3×3 = 9 格 status', () => {
    const wrapper = mountPanel({ imageWidth: 1024, imageHeight: 768, cols: 3, rows: 3 })

    expect(bodyText()).toContain('宫格裁剪')
    expect(bodyText()).toContain('1024 × 768')
    expect(bodyText()).toMatch(/3\s*×\s*3/)
    expect(bodyText()).toContain('9 格')
    expect(document.body.querySelector('button.grid-slice-dock__primary')?.textContent).toContain(
      '裁剪 9 张',
    )
    wrapper.unmount()
  })

  it('emits apply-grid immediately for a 2×4-style square preset', async () => {
    const wrapper = mountPanel({ cols: 3, rows: 3 })

    const presets = bodyButtons().filter((b) => /^\d+×\d+$/.test(b.textContent ?? ''))
    expect(presets.map((b) => b.textContent)).toEqual(['2×2', '3×3', '4×4', '5×5', '6×6', '7×7'])

    presets[0].click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('apply-grid')).toEqual([[{ cols: 2, rows: 2 }]])
    wrapper.unmount()
  })

  it('applies custom cols/rows via 应用划分 then confirm uses applied N', async () => {
    const wrapper = mountPanel({ cols: 3, rows: 3 })

    const inputs = [...document.body.querySelectorAll('input[type="number"]')] as HTMLInputElement[]
    expect(inputs).toHaveLength(2)
    inputs[0].value = '2'
    inputs[0].dispatchEvent(new Event('input'))
    inputs[1].value = '4'
    inputs[1].dispatchEvent(new Event('input'))
    await wrapper.vm.$nextTick()

    const apply = bodyButtons().find((b) => (b.textContent ?? '').includes('应用划分'))
    expect(apply).toBeTruthy()
    apply!.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('apply-grid')).toEqual([[{ cols: 2, rows: 4 }]])

    await wrapper.setProps({ cols: 2, rows: 4 })
    expect(document.body.querySelector('button.grid-slice-dock__primary')?.textContent).toContain(
      '裁剪 8 张',
    )

    ;(document.body.querySelector('button.grid-slice-dock__primary') as HTMLButtonElement).click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('confirm')).toEqual([[{ cols: 2, rows: 4 }]])
    wrapper.unmount()
  })

  it('emits close from 取消 and has no mask/version chrome', async () => {
    const wrapper = mountPanel({ cols: 3, rows: 3 })

    expect(bodyText()).not.toMatch(/画笔|蒙版|版本|对照/)
    const cancel = bodyButtons().find((b) => (b.textContent ?? '').includes('取消'))
    expect(cancel).toBeTruthy()
    cancel!.click()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
