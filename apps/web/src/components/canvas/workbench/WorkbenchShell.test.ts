import { beforeEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import { mount } from '@vue/test-utils'
import WorkbenchShell from './WorkbenchShell.vue'

/**
 * 测试用 slot 注入：字符串模板，或函数式 slot。
 * panel 需要读取 slot props（data-panel-width / data-floating-available），
 * 而字符串 slot 不会被 vue-test-utils 插值 slot props，故 panel 用函数式 slot。
 */
type ShellSlot = string | ((props: Record<string, unknown>) => unknown)

const mountShell = (props: Record<string, unknown> = {}, slots: Record<string, ShellSlot> = {}) =>
  mount(WorkbenchShell, {
    props: { defaultWidth: 400, busy: false, ...props },
    slots: {
      viewport: '<div data-testid="stub-viewport" />',
      panel: (slotProps: Record<string, unknown>) =>
        h('div', {
          'data-testid': 'stub-panel',
          'data-panel-width': String(slotProps.panelWidth),
          'data-floating-available': String(slotProps.floatingAvailable),
        }),
      ...slots,
    },
  })

describe('WorkbenchShell', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true })
  })

  it('渲染 viewport 与 panel 两个槽位，Shell 自身不带业务内容', () => {
    const w = mountShell()
    expect(w.find('[data-testid="workbench-shell"]').exists()).toBe(true)
    expect(w.find('[data-testid="stub-viewport"]').exists()).toBe(true)
    expect(w.find('[data-testid="stub-panel"]').exists()).toBe(true)
    expect(w.find('[data-testid="refine-toolbox"]').exists()).toBe(false)
  })

  it('panel 槽收到 useWorkbenchPanel 的状态与 floatingAvailable', () => {
    const w = mountShell()
    const panel = w.find('[data-testid="stub-panel"]')
    expect(panel.attributes('data-panel-width')).toBe('400')
    expect(panel.attributes('data-floating-available')).toBe('true')
  })

  it('窄屏（<640px）时 floatingAvailable = false（悬浮 dock 退化为面板落点）', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 480, configurable: true })
    const w = mountShell()
    await w.vm.$nextTick()
    expect(w.find('[data-testid="stub-panel"]').attributes('data-floating-available')).toBe('false')
  })

  it('Shell 是 flex 兄弟布局：viewport 与 panel 不同层叠（无绝对定位遮挡）', () => {
    const w = mountShell()
    const shell = w.find('[data-testid="workbench-shell"]')
    expect(shell.classes()).toContain('workbench-shell')
    expect(w.find('[data-testid="workbench-shell-panel"]').exists()).toBe(true)
  })
})
