import { describe, expect, it } from 'vitest'
import { resolveBackfillFields } from './backfill-fields'

describe('resolveBackfillFields', () => {
  it('skips rows whose mapped fields already match', () => {
    expect(
      resolveBackfillFields({
        amount: -10,
        reason: '图像生成',
        kind: 'consume',
        category: 'image',
        status: 'success',
      }),
    ).toBeNull()
  })

  it('keeps a runtime-specific category for platform fallback rows', () => {
    expect(
      resolveBackfillFields({
        amount: -5,
        reason: '平台回退生成',
        kind: 'consume',
        category: 'text',
        status: 'success',
      }),
    ).toBeNull()
  })

  it('repairs sign-incompatible kinds while preserving a specific category', () => {
    expect(
      resolveBackfillFields({
        amount: -5,
        reason: '平台回退生成',
        kind: 'refund',
        category: 'audio',
        status: 'failed_refund',
      }),
    ).toEqual({
      kind: 'consume',
      category: 'audio',
      status: 'success',
    })
  })
})
