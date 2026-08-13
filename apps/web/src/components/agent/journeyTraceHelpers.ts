import type { AgentMessageMetadata, JourneyTraceSnapshot } from '@/components/agent/journeyTraceTypes'
import type { AgentPresentationStepper } from '@/components/agent/presentation/types'
import { PRESENTATION_STEPS } from '@/components/agent/presentation/types'

export function stepperFromJourneySnapshot(snapshot: JourneyTraceSnapshot): AgentPresentationStepper {
  const order = PRESENTATION_STEPS.map((step) => step.id)
  const idx = order.indexOf(snapshot.current)
  return {
    current: snapshot.current,
    completed: idx >= 0 ? order.slice(0, idx) : [],
  }
}

export function extractThreadJourney(
  messages: ReadonlyArray<{ role: string; metadata?: string | null }>,
): JourneyTraceSnapshot | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant' || !message.metadata) continue
    try {
      const meta = JSON.parse(message.metadata) as AgentMessageMetadata
      if (meta.journeyTrace) return meta.journeyTrace
    } catch {
      /* ignore malformed metadata */
    }
  }
  return null
}
