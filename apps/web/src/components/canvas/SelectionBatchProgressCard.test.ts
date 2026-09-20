import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SelectionBatchProgressCard from './SelectionBatchProgressCard.vue'

describe('SelectionBatchProgressCard', () => {
  it('running 时渲染：显示进度 k/N 与各分类计数', () => {
    const wrapper = mount(SelectionBatchProgressCard, {
      props: {
        state: 'running',
        regenerate: false,
        progress: { done: 2, failed: 1, cancelled: 0, timeout: 0, skipped: 1, total: 6, abortReason: 'none' },
      },
    })
    expect(wrapper.find('[data-testid="batch-progress-card"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('3/6') // settled = done+failed
    expect(wrapper.text()).toContain('2')
    expect(wrapper.text()).toContain('1')
  })

  it('regenerate 时标题为批量重新生成', () => {
    const wrapper = mount(SelectionBatchProgressCard, {
      props: {
        state: 'running',
        regenerate: true,
        progress: { done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 4, abortReason: 'none' },
      },
    })
    expect(wrapper.text()).toContain('批量重新生成中')
  })

  it('idle 时不渲染', () => {
    const wrapper = mount(SelectionBatchProgressCard, {
      props: {
        state: 'idle',
        regenerate: false,
        progress: { done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 0, abortReason: 'none' },
      },
    })
    expect(wrapper.find('[data-testid="batch-progress-card"]').exists()).toBe(false)
  })

  it('stopping 时显示停止中，且停止按钮隐藏（已在停止流程中）', async () => {
    const wrapper = mount(SelectionBatchProgressCard, {
      props: {
        state: 'stopping',
        regenerate: false,
        progress: { done: 1, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 3, abortReason: 'user_stopped' },
      },
    })
    expect(wrapper.text()).toContain('停止中')
    expect(wrapper.find('[data-testid="batch-progress-stop"]').exists()).toBe(false)
  })

  it('running 时点击停止按钮 emit stop', async () => {
    const wrapper = mount(SelectionBatchProgressCard, {
      props: {
        state: 'running',
        regenerate: false,
        progress: { done: 1, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 3, abortReason: 'none' },
      },
    })
    await wrapper.find('[data-testid="batch-progress-stop"]').trigger('click')
    expect(wrapper.emitted('stop')).toBeTruthy()
  })

  it('进度条宽度反映已完成比例', () => {
    const wrapper = mount(SelectionBatchProgressCard, {
      props: {
        state: 'running',
        regenerate: false,
        progress: { done: 3, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 4, abortReason: 'none' },
      },
    })
    const bar = wrapper.find('[data-testid="batch-progress-bar"]')
    expect(bar.attributes('style')).toContain('75%')
  })
})
