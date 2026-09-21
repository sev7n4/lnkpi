import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import RefineWorkbench from './RefineWorkbench.vue'

/** 每个用例共用一个 pinia：测试里取的 store 必须与组件内注入的是同一个实例 */
let pinia: Pinia

// 只验证生产接线：workbench → viewport → rail 的 hasAfter 透传。
// 兄弟组件 RefineSidePanel 较重，按需替身；viewport 的 canvas 依赖（MaskEditor / ImageLoupe）换轻量替身。
const mountWorkbench = (props: Record<string, unknown> = {}) =>
  mount(RefineWorkbench, {
    props: {
      nodeId: 'n1',
      beforeUrl: 'blob:before',
      url: 'blob:before',
      versions: [],
      sessionId: 's1',
      width: 100,
      height: 100,
      ...props,
    },
    global: {
      plugins: [pinia],
      stubs: {
        RefineSidePanel: { template: '<div class="side-panel-stub" />' },
        MaskEditor: { template: '<div class="mask-editor-stub" />' },
        ImageLoupe: { template: '<div class="loupe-stub"><slot /></div>' },
      },
    },
  })

const openCompareMenu = async (w: ReturnType<typeof mountWorkbench>) => {
  await w.find('[data-testid="rail-view-compare"]').trigger('click')
}

describe('RefineWorkbench 生产接线', () => {
  beforeEach(() => { pinia = createPinia(); setActivePinia(pinia) })

  it('节点无「处理后」版本时，左栏对照两项置灰', async () => {
    const w = mountWorkbench({
      versions: [{ id: 'v1', url: 'blob:before', createdAt: '2026-01-01T00:00:00.000Z', source: 'generate' }],
    })
    await openCompareMenu(w)
    expect(w.find('[data-testid="rail-compare-option-split"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="rail-compare-option-wipe"]').attributes('disabled')).toBeDefined()
  })

  it('节点已有「处理后」版本时，左栏对照两项可用', async () => {
    const w = mountWorkbench({
      versions: [
        { id: 'v1', url: 'blob:before', createdAt: '2026-01-01T00:00:00.000Z', source: 'generate' },
        { id: 'v2', url: 'blob:after', createdAt: '2026-01-02T00:00:00.000Z', source: 'edit' },
      ],
    })
    await openCompareMenu(w)
    expect(w.find('[data-testid="rail-compare-option-split"]').attributes('disabled')).toBeUndefined()
    expect(w.find('[data-testid="rail-compare-option-wipe"]').attributes('disabled')).toBeUndefined()
  })
})
