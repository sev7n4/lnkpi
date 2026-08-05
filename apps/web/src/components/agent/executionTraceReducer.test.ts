import { describe, expect, it } from 'vitest'
import {
  applyCanvasAction,
  applyNodeStatus,
  applyTextReplaceStage,
  applyToolCall,
  createExecutionTrace,
  finalizeExecutionTrace,
} from '@/components/agent/executionTraceReducer'
import { labelFromTextReplace } from '@/components/agent/executionStepLabels'

describe('executionStepLabels', () => {
  it('maps sidebar copy stages', () => {
    expect(labelFromTextReplace('好的，我来生成图片「模特」')).toBe('理解需求')
    expect(labelFromTextReplace('已在画布创建节点，正在生成…')).toBe('创建画布节点')
    expect(labelFromTextReplace('「模特」生成完成，请在画布查看节点。')).toBe('生成完成')
  })
})

describe('executionTraceReducer', () => {
  it('records text_replace stages without duplicate labels', () => {
    const trace = createExecutionTrace()
    applyTextReplaceStage(trace, '好的，我来生成图片「模特」')
    applyTextReplaceStage(trace, '已在画布创建节点，正在生成…')
    applyTextReplaceStage(trace, '「模特」生成完成，请在画布查看节点。')
    expect(trace.steps.map((s) => s.label)).toEqual(['理解需求', '创建画布节点', '生成完成'])
  })

  it('tracks node_status running then done', () => {
    const trace = createExecutionTrace()
    applyNodeStatus(trace, { nodeId: 'n1', status: 'generating' })
    applyNodeStatus(trace, { nodeId: 'n1', status: 'completed' })
    expect(trace.steps).toHaveLength(1)
    expect(trace.steps[0]?.label).toBe('节点出图完成')
    expect(trace.steps[0]?.status).toBe('done')
  })

  it('adds canvas_action step', () => {
    const trace = createExecutionTrace()
    applyCanvasAction(trace, {
      type: 'add_node',
      payload: { id: 'n1', nodeType: 'image', data: { title: '模特图' } },
    })
    expect(trace.steps[0]?.label).toContain('添加图片节点')
    expect(trace.steps[0]?.meta?.nodeId).toBe('n1')
  })

  it('finalizes totalMs', () => {
    const trace = createExecutionTrace()
    applyToolCall(trace, 'run_image_generation')
    finalizeExecutionTrace(trace)
    expect(trace.totalMs).toBeGreaterThanOrEqual(0)
    expect(trace.steps[0]?.status).toBe('done')
  })
})
