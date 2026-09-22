import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MattingPanel from './MattingPanel.vue'

const baseProps = { beforeUrl: 'https://example.com/before.png' }

describe('MattingPanel', () => {
  it('预览层带棋盘格 checkerboard 类（透明区辨识）', () => {
    const w = mount(MattingPanel, { props: baseProps })
    const preview = w.find('[data-testid="matting-preview"]')
    expect(preview.exists()).toBe(true)
    expect(preview.classes()).toContain('checkerboard')
  })

  it('mattingUnavailable 时 run-auto 禁用且 title 为「抠图服务未启用」', () => {
    const w = mount(MattingPanel, { props: { ...baseProps, mattingUnavailable: true } })
    const btn = w.find('[data-testid="matting-run-auto"]')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
    expect(btn.attributes('title')).toBe('抠图服务未启用')
  })

  it('canApply=false 时 apply 禁用，canApply=true 时可用', () => {
    const wOff = mount(MattingPanel, { props: { ...baseProps, canApply: false } })
    expect((wOff.find('[data-testid="matting-apply"]').element as HTMLButtonElement).disabled).toBe(true)
    const wOn = mount(MattingPanel, { props: { ...baseProps, canApply: true } })
    expect((wOn.find('[data-testid="matting-apply"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('点击 run-auto / run-mask / apply 分别上抛对应事件（哑组件，动作在父级）', async () => {
    const w = mount(MattingPanel, { props: { ...baseProps, maskAvailable: true, canApply: true } })
    await w.find('[data-testid="matting-run-auto"]').trigger('click')
    await w.find('[data-testid="matting-run-mask"]').trigger('click')
    await w.find('[data-testid="matting-apply"]').trigger('click')
    expect(w.emitted('run-auto')).toHaveLength(1)
    expect(w.emitted('run-mask')).toHaveLength(1)
    expect(w.emitted('apply')).toHaveLength(1)
  })
})
