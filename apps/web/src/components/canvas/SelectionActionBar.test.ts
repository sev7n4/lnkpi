import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'

vi.mock('@vue-flow/core', () => ({
  useVueFlow: () => ({
    viewport: ref({ x: 0, y: 0, zoom: 1 }),
    nodes: ref([]),
    findNode: () => undefined,
  }),
}))
vi.mock('@/composables/useCanvasGrouping', () => ({
  getAbsolutePosition: () => ({ x: 100, y: 100 }),
  getNodeSize: () => ({ w: 200, h: 200 }),
}))

import SelectionActionBar from './SelectionActionBar.vue'

function mountBar(props: Record<string, unknown> = {}) {
  const wrapper = mount(SelectionActionBar, {
    props: { node: { id: 'n1', type: 'image' }, gridSlice: true, hasUrl: true, ...props },
    global: { stubs: { teleport: true } },
  })
  return wrapper
}

describe('SelectionActionBar', () => {
  it('forwards grid picker slice(cols, rows)', async () => {
    const wrapper = mountBar()
    await wrapper.get('button').trigger('click')
    await wrapper.get('[data-cell="3-2"]').trigger('pointerenter', { pointerType: 'mouse' })
    await wrapper.get('[data-cell="3-2"]').trigger('click')
    expect(wrapper.emitted('slice')).toEqual([[3, 2]])
    wrapper.unmount()
  })

  it('emits download and save-asset, disables them without url', async () => {
    const wrapper = mountBar()
    await wrapper.get('[data-action="download"]').trigger('click')
    await wrapper.get('[data-action="save-asset"]').trigger('click')
    expect(wrapper.emitted('download')).toBeTruthy()
    expect(wrapper.emitted('save-asset')).toBeTruthy()
    await wrapper.setProps({ hasUrl: false })
    expect(wrapper.get('[data-action="download"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-action="save-asset"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('renders refine button and no upscale button', async () => {
    const wrapper = mountBar()
    const refine = wrapper.get('[data-action="refine"]')
    expect(refine.text()).toContain('精修')
    expect(refine.attributes('disabled')).toBeUndefined()
    const allText = wrapper.findAll('button').map((b) => b.text()).join('|')
    expect(allText).not.toContain('放大')
    expect(wrapper.find('[data-action="upscale"]').exists()).toBe(false)
    await refine.trigger('click')
    expect(wrapper.emitted('edit')).toBeTruthy()
    wrapper.unmount()
  })

  it('renders exactly the expected action buttons (no extra/missing)', async () => {
    const wrapper = mountBar()
    const actions = wrapper.findAll('.toolbar-action')
    // 6 个工具按钮 + 宫格下拉入口（同 class）
    expect(actions).toHaveLength(7)
    const byId = Object.fromEntries(
      actions.filter((b) => b.attributes('data-action')).map((b) => [b.attributes('data-action'), b.text().trim()]),
    )
    expect(Object.keys(byId).sort()).toEqual(['crop', 'download', 'matting', 'refine', 'rotate', 'save-asset'])
    expect(byId['refine']).toBe('精修')
    expect(byId['matting']).toBe('抠图')
    expect(byId['crop']).toBe('裁剪')
    expect(byId['rotate']).toBe('旋转/翻转')
    expect(byId['download']).toBe('下载图片')
    expect(byId['save-asset']).toBe('存入资产库')
    wrapper.unmount()
  })

  it('renders disabled tool placeholders with explanatory titles', async () => {
    const wrapper = mountBar()
    for (const id of ['matting', 'crop', 'rotate']) {
      const btn = wrapper.get(`[data-action="${id}"]`)
      expect(btn.attributes('disabled')).toBeDefined()
      expect(String(btn.attributes('title'))).toContain('后续能力包点亮')
    }
    wrapper.unmount()
  })

  it('counter-scales the bar so it keeps constant on-screen size', async () => {
    const wrapper = mountBar({ zoom: 0.4 })
    const inner = wrapper.get('[data-testid="bar-inner"]')
    expect(inner.attributes('style')).toContain('scale(1.2)')
    wrapper.unmount()
  })
})
