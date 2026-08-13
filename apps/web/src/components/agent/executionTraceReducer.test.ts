import { describe, expect, it } from 'vitest'
import type { JourneyTraceSnapshot } from '@/components/agent/journeyTraceTypes'
import { JOURNEY_STEP_LABELS } from '@/components/agent/journeyTraceTypes'
import {
  applyCanvasAction,
  applyJourneyUpdate,
  applyNodeStatus,
  applyPhaseHint,
  applyStep,
  applyTaskUpdate,
  applyTextReplaceStage,
  applyToolCall,
  createExecutionTrace,
  finalizeExecutionTrace,
  replayExecutionTraceEvents,
  workflowStepsFromSnapshot,
} from '@/components/agent/executionTraceReducer'
import { labelFromTextReplace } from '@/components/agent/executionStepLabels'

const JOURNEY_STEP_ORDER = [
  'image_qa',
  'scheme_draft',
  'macro_select',
  'ssot_persist',
  'shot_plan',
  'topo_preview',
  'generating',
  'delivery',
  'done',
] as const

function buildMockJourneySnapshot(
  current: (typeof JOURNEY_STEP_ORDER)[number] = 'macro_select',
  overrides?: Partial<JourneyTraceSnapshot>,
): JourneyTraceSnapshot {
  const now = '2026-08-13T04:00:00Z'
  return {
    version: 1,
    flowMode: 'product_visual',
    current,
    startedAt: now,
    updatedAt: now,
    steps: JOURNEY_STEP_ORDER.map((id) => ({
      id,
      label: JOURNEY_STEP_LABELS[id],
      status:
        id === current
          ? 'running'
          : JOURNEY_STEP_ORDER.indexOf(id) < JOURNEY_STEP_ORDER.indexOf(current)
            ? 'done'
            : 'pending',
    })),
    ...overrides,
  }
}

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

  it('applies step events and dedupes text_stage', () => {
    const trace = createExecutionTrace()
    applyTextReplaceStage(trace, '好的，我来生成图片「模特」')
    applyStep(trace, {
      id: 'node:parse_atomic_intent',
      label: '理解需求',
      status: 'done',
      ms: 50,
    })
    expect(trace.steps.some((s) => s.kind === 'text_stage')).toBe(false)
    expect(trace.steps.some((s) => s.id === 'node:parse_atomic_intent')).toBe(true)
  })

  it('applies phase hint as waiting_user', () => {
    const trace = createExecutionTrace()
    applyPhaseHint(trace, { phase: 'await_confirm', label: '等待你确认方案' })
    expect(trace.steps[0]?.status).toBe('waiting_user')
  })

  it('replays persisted execution events', () => {
    const trace = replayExecutionTraceEvents([
      { type: 'text_replace', data: { text: '好的，我来生成图片「模特」' } },
      { type: 'step', data: { id: 'n1', label: '理解需求', status: 'done', ms: 12 } },
    ])
    expect(trace.steps.some((s) => s.label === '理解需求')).toBe(true)
    expect(trace.totalMs).toBeGreaterThanOrEqual(0)
  })
})

describe('applyJourneyUpdate', () => {
  it('creates 9 workflow_step entries from snapshot', () => {
    const trace = createExecutionTrace()
    applyJourneyUpdate(trace, buildMockJourneySnapshot('macro_select'))

    const workflowSteps = trace.steps.filter((s) => s.kind === 'workflow_step')
    expect(workflowSteps).toHaveLength(9)
    expect(workflowSteps.map((s) => s.journeyStepId)).toEqual([...JOURNEY_STEP_ORDER])
  })

  it('maps macro_select running and prior steps done', () => {
    const trace = createExecutionTrace()
    applyJourneyUpdate(trace, buildMockJourneySnapshot('macro_select'))

    const macro = trace.steps.find((s) => s.journeyStepId === 'macro_select')
    expect(macro?.status).toBe('running')
    expect(macro?.label).toBe('选宏观风格')

    const prior = trace.steps.find((s) => s.journeyStepId === 'scheme_draft')
    expect(prior?.status).toBe('done')

    const next = trace.steps.find((s) => s.journeyStepId === 'ssot_persist')
    expect(next?.status).toBe('pending')
  })

  it('maps summary to workflow step detail', () => {
    const trace = createExecutionTrace()
    const snapshot = buildMockJourneySnapshot('macro_select')
    snapshot.steps = snapshot.steps.map((s) =>
      s.id === 'macro_select'
        ? { ...s, summary: '已选：A 湖鲜原境风、B 礼盒臻享风' }
        : s,
    )
    applyJourneyUpdate(trace, snapshot)

    const macro = trace.steps.find((s) => s.journeyStepId === 'macro_select')
    expect(macro?.detail).toBe('已选：A 湖鲜原境风、B 礼盒臻享风')
  })

  it('maps skipped and failed statuses', () => {
    const trace = createExecutionTrace()
    const snapshot = buildMockJourneySnapshot('ssot_persist')
    snapshot.steps = snapshot.steps.map((s) => {
      if (s.id === 'macro_select') return { ...s, status: 'skipped' as const }
      if (s.id === 'image_qa') return { ...s, status: 'failed' as const, summary: '识图失败' }
      return s
    })
    applyJourneyUpdate(trace, snapshot)

    expect(trace.steps.find((s) => s.journeyStepId === 'macro_select')?.status).toBe('skipped')
    expect(trace.steps.find((s) => s.journeyStepId === 'image_qa')?.status).toBe('failed')
    expect(trace.steps.find((s) => s.journeyStepId === 'image_qa')?.detail).toBe('识图失败')
  })

  it('updates existing workflow steps on subsequent snapshot', () => {
    const trace = createExecutionTrace()
    applyJourneyUpdate(trace, buildMockJourneySnapshot('macro_select'))
    applyJourneyUpdate(trace, buildMockJourneySnapshot('ssot_persist'))

    expect(trace.steps.filter((s) => s.kind === 'workflow_step')).toHaveLength(9)
    expect(trace.steps.find((s) => s.journeyStepId === 'macro_select')?.status).toBe('done')
    expect(trace.steps.find((s) => s.journeyStepId === 'ssot_persist')?.status).toBe('running')
  })

  it('attaches text_stage child to running workflow step', () => {
    const trace = createExecutionTrace()
    applyJourneyUpdate(trace, buildMockJourneySnapshot('macro_select'))
    applyTextReplaceStage(trace, '好的，我来生成图片「模特」')

    const macro = trace.steps.find((s) => s.journeyStepId === 'macro_select')
    const child = trace.steps.find((s) => s.kind === 'text_stage')
    expect(macro?.id).toBeTruthy()
    expect(child?.parentStepId).toBe(macro?.id)
  })

  it('attaches canvas and task children to running workflow step', () => {
    const trace = createExecutionTrace()
    applyJourneyUpdate(trace, buildMockJourneySnapshot('generating'))

    applyCanvasAction(trace, {
      type: 'add_node',
      payload: { id: 'n1', nodeType: 'image', data: { title: '模特图' } },
    })
    applyTaskUpdate(trace, { id: 'task-1', status: 'running', title: '模特' })

    const generating = trace.steps.find((s) => s.journeyStepId === 'generating')
    const canvas = trace.steps.find((s) => s.kind === 'canvas')
    const task = trace.steps.find((s) => s.kind === 'task')
    expect(canvas?.parentStepId).toBe(generating?.id)
    expect(task?.parentStepId).toBe(generating?.id)
  })

  it('rebinds orphan child steps when journey advances', () => {
    const trace = createExecutionTrace()
    applyJourneyUpdate(trace, buildMockJourneySnapshot('macro_select'))
    applyTextReplaceStage(trace, '好的，我来生成图片「模特」')

    applyJourneyUpdate(trace, buildMockJourneySnapshot('ssot_persist'))
    applyCanvasAction(trace, {
      type: 'add_node',
      payload: { id: 'n1', nodeType: 'text', data: { title: '方案 SSOT' } },
    })

    const ssot = trace.steps.find((s) => s.journeyStepId === 'ssot_persist')
    const canvas = trace.steps.find((s) => s.kind === 'canvas')
    expect(canvas?.parentStepId).toBe(ssot?.id)
  })
})

describe('workflowStepsFromSnapshot', () => {
  it('returns 9 workflow steps without mutating trace', () => {
    const snapshot = buildMockJourneySnapshot('macro_select')
    const steps = workflowStepsFromSnapshot(snapshot)

    expect(steps).toHaveLength(9)
    expect(steps.every((s) => s.kind === 'workflow_step')).toBe(true)
    expect(steps.find((s) => s.journeyStepId === 'macro_select')?.status).toBe('running')
  })
})
