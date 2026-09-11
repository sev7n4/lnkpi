import { FUNDAMENTALS, formatFundamentalsBlock } from './fundamentals'
import type { EditIntent, GenerationScene } from './types'

const GENERATION_SCENES: GenerationScene[] = []
const EDIT_INTENTS: EditIntent[] = []

export { FUNDAMENTALS, formatFundamentalsBlock }
export function listGenerationScenes() { return GENERATION_SCENES }
export function listEditIntents() { return EDIT_INTENTS }
export function getGenerationScene(id: string) {
  return GENERATION_SCENES.find((s) => s.id === id)
}
export function getEditIntent(id: string) {
  return EDIT_INTENTS.find((i) => i.id === id)
}
