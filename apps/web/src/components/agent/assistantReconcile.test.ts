/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  looksLikeConfirmTurn,
  shouldApplyReconciledAssistant,
} from './assistantReconcile'

describe('shouldApplyReconciledAssistant', () => {
  it('rejects stale confirm-gate overwrite of in-progress exec tip', () => {
    const local = '正在按方案拆解画布并出图，请稍候…'
    const db =
      '定位：露营折叠椅\n请确认是否按此方案拆解画布并出图；如需修改请直接说明。'
    expect(shouldApplyReconciledAssistant(local, db)).toBe(false)
  })

  it('accepts longer completed progress from DB', () => {
    const local = '正在按方案拆解画布并出图，请稍候…'
    const db =
      '正在按方案拆解画布并出图，请稍候…已按方案拆解 9 个画布节点骨架\n· 主图：出图成功'
    expect(shouldApplyReconciledAssistant(local, db)).toBe(true)
  })

  it('accepts db when local empty', () => {
    expect(shouldApplyReconciledAssistant('', 'hello')).toBe(true)
  })
})

describe('looksLikeConfirmTurn', () => {
  it('matches chip confirm', () => {
    expect(looksLikeConfirmTurn('确认')).toBe(true)
  })

  it('rejects long brief', () => {
    expect(
      looksLikeConfirmTurn('请为保温杯写一份方案，写完后先等我确认。'),
    ).toBe(false)
  })
})
