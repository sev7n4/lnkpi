import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentExecutionTrace from './AgentExecutionTrace.vue'
import AgentJourneyStepList from './AgentJourneyStepList.vue'
import {
  applyCanvasAction,
  applyJourneyUpdate,
  applyTextReplaceStage,
  createExecutionTrace,
  finalizeExecutionTrace,
} from './executionTraceReducer'
import type { JourneyTraceSnapshot } from './journeyTraceTypes'
import { JOURNEY_STEP_LABELS } from './journeyTraceTypes'

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

describe('AgentJourneyStepList', () => {
  it('renders nine workflow steps with done line-through', () => {
    const trace = createExecutionTrace()
    applyJourneyUpdate(trace, buildMockJourneySnapshot('macro_select'))
    const workflowSteps = trace.steps.filter((s) => s.kind === 'workflow_step')

    const wrapper = mount(AgentJourneyStepList, {
      props: { steps: workflowSteps },
    })

    expect(wrapper.find('[data-testid="agent-journey-step-list"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-journey-step-id]').length).toBe(9)
    expect(
      wrapper.find('[data-journey-step-id="image_qa"] [data-testid="journey-step-label"]').classes(),
    ).toContain('line-through')
    expect(
      wrapper
        .find('[data-journey-step-id="macro_select"] [data-testid="journey-step-label"]')
        .classes(),
    ).not.toContain('line-through')
  })

  it('shows macro summary and readonly scheme cards from snapshot', () => {
    const trace = createExecutionTrace()
    const snapshot = buildMockJourneySnapshot('ssot_persist')
    snapshot.steps = snapshot.steps.map((s) =>
      s.id === 'macro_select'
        ? {
            ...s,
            status: 'done' as const,
            summary: '已选：A 湖鲜原境风、B 礼盒臻享风',
            snapshot: {
              kind: 'macro_select',
              schemes: [
                { id: 'A', label: '湖鲜原境风', summary: '湖鲜场景' },
                { id: 'B', label: '礼盒臻享风', summary: '红金礼盒' },
              ],
              selectedIds: ['A', 'B'],
            },
          }
        : s,
    )
    applyJourneyUpdate(trace, snapshot)
    const workflowSteps = trace.steps.filter((s) => s.kind === 'workflow_step')

    const wrapper = mount(AgentJourneyStepList, {
      props: { steps: workflowSteps, journeySteps: snapshot.steps },
    })

    const macro = wrapper.find('[data-journey-step-id="macro_select"]')
    expect(macro.find('[data-testid="journey-step-summary"]').text()).toBe(
      '已选：A 湖鲜原境风、B 礼盒臻享风',
    )
    expect(wrapper.find('[data-testid="macro-scheme-cards"]').exists()).toBe(true)
    const checkboxes = wrapper.findAll('[data-scheme-id] input[type="checkbox"]')
    expect(checkboxes.every((cb) => (cb.element as HTMLInputElement).disabled)).toBe(true)
    expect((checkboxes[0]?.element as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[1]?.element as HTMLInputElement).checked).toBe(true)
  })
})

describe('AgentExecutionTrace', () => {
  it('renders workflow and operation sections separately', async () => {
    const trace = createExecutionTrace()
    applyJourneyUpdate(trace, buildMockJourneySnapshot('generating'))
    applyTextReplaceStage(trace, '好的，我来生成图片「模特」')
    applyCanvasAction(trace, {
      type: 'add_node',
      payload: { id: 'n1', nodeType: 'image', data: { title: '模特图' } },
    })

    const wrapper = mount(AgentExecutionTrace, {
      props: { trace, streaming: false },
    })

    await wrapper.find('.agent-trace-toggle').trigger('click')

    expect(wrapper.find('[data-testid="journey-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="operation-section"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-journey-step-list"]').exists()).toBe(true)

    const operationItems = wrapper.findAll('[data-testid="operation-step"]')
    expect(operationItems.length).toBe(2)
    expect(operationItems.some((li) => li.text().includes('理解需求'))).toBe(true)
    expect(operationItems.some((li) => li.text().includes('添加图片节点'))).toBe(true)
    expect(wrapper.findAll('[data-journey-step-id]').length).toBe(9)
  })

  it('shows streaming header with current journey step number', () => {
    const trace = createExecutionTrace()
    applyJourneyUpdate(trace, buildMockJourneySnapshot('macro_select'))

    const wrapper = mount(AgentExecutionTrace, {
      props: { trace, streaming: true },
    })

    expect(wrapper.find('.agent-trace-toggle').text()).toContain('执行过程（进行中… · 第 3/9 步）')
  })

  it('shows completed header with nine steps when journey present', () => {
    const trace = createExecutionTrace()
    applyJourneyUpdate(trace, buildMockJourneySnapshot('done'))
    finalizeExecutionTrace(trace)

    const wrapper = mount(AgentExecutionTrace, {
      props: { trace, streaming: false },
    })

    expect(wrapper.find('.agent-trace-toggle').text()).toContain('执行过程（9 步）')
  })
})
