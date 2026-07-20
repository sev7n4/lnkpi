import { describe, expect, it } from 'vitest'
import { resolveDockFailureChip } from './dockFailureChip'

describe('resolveDockFailureChip', () => {
  it('does not render without errorMessage on non-fallback statuses', () => {
    expect(
      resolveDockFailureChip({ status: 'error', errorMessage: undefined }),
    ).toEqual({ visible: false, message: '', showCopy: false })
    expect(
      resolveDockFailureChip({ status: 'failed', errorMessage: '' }),
    ).toEqual({ visible: false, message: '', showCopy: false })
    expect(
      resolveDockFailureChip({ status: 'completed', errorMessage: '旧错误' }),
    ).toEqual({ visible: false, message: '', showCopy: false })
  })

  it('shows truncated message and copy affordance when failed with errorMessage', () => {
    const long = '上游超时，请稍后重试。这是一段很长的失败说明用于截断验证'
    const view = resolveDockFailureChip({ status: 'error', errorMessage: long })
    expect(view.visible).toBe(true)
    expect(view.showCopy).toBe(true)
    expect(view.message.length).toBeLessThanOrEqual(48)
    expect(view.message.length).toBeGreaterThan(0)
  })

  it('shows chip for fallback_pending even without errorMessage', () => {
    const view = resolveDockFailureChip({
      status: 'fallback_pending',
      errorMessage: undefined,
    })
    expect(view.visible).toBe(true)
    expect(view.showCopy).toBe(true)
    expect(view.message).toBeTruthy()
  })
})
