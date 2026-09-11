import { FUNDAMENTALS, formatFundamentalsBlock } from './fundamentals'
import { e3IdentityClothing } from './intents/e3-identity-clothing'
import { e4CombineRefs } from './intents/e4-combine-refs'
import { e5TransparentCutout } from './intents/e5-transparent-cutout'
import { g1StyleLighting } from './scenes/g1-style-lighting'
import { g3ExactText } from './scenes/g3-exact-text'
import type { EditIntent, GenerationScene } from './types'

const GENERATION_SCENES: GenerationScene[] = [g1StyleLighting, g3ExactText]
const EDIT_INTENTS: EditIntent[] = [e3IdentityClothing, e4CombineRefs, e5TransparentCutout]

export { FUNDAMENTALS, formatFundamentalsBlock }
export function listGenerationScenes() { return GENERATION_SCENES }
export function listEditIntents() { return EDIT_INTENTS }
export function getGenerationScene(id: string) {
  return GENERATION_SCENES.find((s) => s.id === id)
}
export function getEditIntent(id: string) {
  return EDIT_INTENTS.find((i) => i.id === id)
}
