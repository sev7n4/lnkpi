import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import RefineSidePanel from './RefineSidePanel.vue'

const baseProps = {
  nodeId: 'n1', beforeUrl: 'blob:before', versions: [], sessionId: 's1',
  panelWidth: 400, collapsed: false, isNarrow: false, insetRight: 400,
}

// R8 — 简报里 mount 的 global.plugins 与 beforeEach 各造一个 pinia（两个实例）是计划缺陷，
// 统一为「每个用例共用一个 pinia」：beforeEach 创建并 setActivePinia，mount 复用同一个实例。
let pinia: Pinia
let current: VueWrapper | null = null

// 组件正文包在 <Teleport to="body"> 里，teleport 内容会渲染到 document.body、
// 脱离 wrapper 子树，w.find / w.element 查不到。沿用本仓库测试约定（AgentAssetPicker.test.ts）
// 不 stub Teleport，改查 document.body。断言与 testid 与原简报逐字一致。
const mountPanel = (overrides: Record<string, unknown> = {}) => {
  current = mount(RefineSidePanel, {
    props: { ...baseProps, ...overrides },
    global: {
      plugins: [pinia],
      stubs: {
        GuidePickerPopover: { template: '<div />' },
        VersionStrip: { name: 'VersionStrip', template: '<div />' },
      },
    },
  })
  return current
}

const q = (sel: string) => document.body.querySelector(sel)
const qa = (sel: string) => Array.from(document.body.querySelectorAll(sel))

describe('RefineSidePanel 三段式', () => {
  beforeEach(() => { pinia = createPinia(); setActivePinia(pinia) })
  afterEach(() => { current?.unmount(); current = null })

  it('段落顺序：head → 对照带 → 工具箱 → dock', () => {
    mountPanel()
    const order = qa(
      '.refine-side__head, [data-testid="refine-compare-band"], [data-testid="refine-toolbox"], [data-testid="refine-dock"]',
    ).map((el) => el.getAttribute('data-testid') ?? 'head')
    expect(order).toEqual(['head', 'refine-compare-band', 'refine-toolbox', 'refine-dock'])
  })

  it('对照带与 dock 在滚动容器之外，整栏只有一个滚动区', () => {
    mountPanel()
    const body = q('.refine-side__body')
    expect(body).not.toBeNull()
    expect(body!.querySelector('[data-testid="refine-toolbox"]')).not.toBeNull()
    expect(body!.querySelector('[data-testid="refine-compare-band"]')).toBeNull()
    expect(body!.querySelector('[data-testid="refine-dock"]')).toBeNull()
    expect(qa('[data-testid="toolbox-scroll"]').length).toBe(1)
  })

  it('不再有旧的三排图标工具条', () => {
    mountPanel()
    expect(q('.refine-side__toolbar')).toBeNull()
    expect(q('[title="点选主体"]')).toBeNull()
    expect(q('[title="魔棒"]')).toBeNull()
  })

  it('不再有对照模式按钮 / 放大镜 / 细节放大', () => {
    mountPanel()
    expect(q('[title="左右对照"]')).toBeNull()
    expect(q('[title="重叠滑竿"]')).toBeNull()
    expect(q('[title="放大镜"]')).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('细节放大')
  })

  it('收起态：只剩头部，对照带与 dock 都不渲染', () => {
    mountPanel({ collapsed: true, insetRight: 44 })
    const side = q('.refine-side')
    expect(side).not.toBeNull()
    expect(side!.classList.contains('is-collapsed')).toBe(true)
    expect(q('[data-testid="refine-compare-band"]')).toBeNull()
    expect(q('[data-testid="refine-toolbox"]')).toBeNull()
    expect(q('[data-testid="refine-dock"]')).toBeNull()
  })

  it('右栏头部的收起钮仍在', () => {
    mountPanel()
    expect(q('.refine-side__collapse')).not.toBeNull()
  })
})
