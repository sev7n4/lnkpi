import { describe, expect, it } from 'vitest'
import { extractThreadJourney, stepperFromJourneySnapshot } from './journeyTraceHelpers'
import type { JourneyTraceSnapshot } from './journeyTraceTypes'
import { JOURNEY_STEP_LABELS } from './journeyTraceTypes'

function buildSnapshot(current: JourneyTraceSnapshot['current']): JourneyTraceSnapshot {
  const order = [
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
  const now = '2026-08-13T04:00:00Z'
  return {
    version: 1,
    flowMode: 'product_visual',
    current,
    startedAt: now,
    updatedAt: now,
    steps: order.map((id) => ({
      id,
      label: JOURNEY_STEP_LABELS[id],
      status: id === current ? 'running' : 'pending',
    })),
  }
}

describe('stepperFromJourneySnapshot', () => {
  it('derives current and completed from journey snapshot', () => {
    const stepper = stepperFromJourneySnapshot(buildSnapshot('macro_select'))
    expect(stepper.current).toBe('macro_select')
    expect(stepper.completed).toEqual(['image_qa', 'scheme_draft'])
  })
})

describe('extractThreadJourney', () => {
  it('returns the latest assistant journeyTrace from metadata', () => {
    const snapshot = buildSnapshot('generating')
    const messages = [
      {
        role: 'assistant',
        metadata: JSON.stringify({ journeyTrace: buildSnapshot('macro_select') }),
      },
      { role: 'user', metadata: null },
      {
        role: 'assistant',
        metadata: JSON.stringify({ journeyTrace: snapshot }),
      },
    ]

    expect(extractThreadJourney(messages)).toEqual(snapshot)
  })

  it('returns null when no assistant metadata contains journeyTrace', () => {
    expect(
      extractThreadJourney([
        { role: 'user', metadata: null },
        { role: 'assistant', metadata: JSON.stringify({ executionTrace: {} }) },
      ]),
    ).toBeNull()
  })
})
