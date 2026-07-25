/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { emptyTaskProgress, type AgentTaskProgressState } from './agentTaskProgress'
import {
  reconcileTaskProgress,
  shouldFinishTaskCard,
  synthesizeSummary,
} from './taskProgressReconcile'

describe('taskProgressReconcile', () => {
  it('maps completed+url to done and finishes when no generating images', () => {
    let state: AgentTaskProgressState = emptyTaskProgress()
    state = {
      ...state,
      items: [
        { id: 'banner', title: 'Banner', nodeId: 'i1', kind: 'image', status: 'running' },
        {
          id: 'copy_main',
          title: '主文案',
          nodeId: 't1',
          kind: 'text',
          status: 'needs_user',
          errorHint: '请确认主文案后写入',
        },
      ],
    }
    const nodes = [
      { id: 'i1', type: 'image', data: { status: 'completed', url: 'https://x/a.png' } },
      { id: 't1', type: 'text', data: { status: 'draft', content: '' } },
    ]
    state = reconcileTaskProgress(state, nodes)
    expect(state.items[0].status).toBe('done')
    expect(state.items[1].status).toBe('needs_user')
    expect(shouldFinishTaskCard(state, nodes)).toBe(true)
    const summary = synthesizeSummary(state)
    expect(summary.success).toBe(1)
    expect(summary.needsUser).toBe(1)
  })

  it('does not finish while an image is generating', () => {
    const state: AgentTaskProgressState = {
      ...emptyTaskProgress(),
      items: [{ id: 'banner', title: 'Banner', nodeId: 'i1', kind: 'image', status: 'running' }],
    }
    const nodes = [{ id: 'i1', type: 'image', data: { status: 'generating' } }]
    expect(shouldFinishTaskCard(state, nodes)).toBe(false)
  })
})
