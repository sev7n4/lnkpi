import { FUNDAMENTALS, formatFundamentalsBlock } from './fundamentals'
import { e1TranslateLayout } from './intents/e1-translate-layout'
import { e2StyleTransfer } from './intents/e2-style-transfer'
import { e3IdentityClothing } from './intents/e3-identity-clothing'
import { e4CombineRefs } from './intents/e4-combine-refs'
import { e5TransparentCutout } from './intents/e5-transparent-cutout'
import { e6DrawingToRealistic } from './intents/e6-drawing-to-realistic'
import { e7RemoveObject } from './intents/e7-remove-object'
import { e8InsertPerson } from './intents/e8-insert-person'
import { g1StyleLighting } from './scenes/g1-style-lighting'
import { g2ProcessInfographic } from './scenes/g2-process-infographic'
import { g3ExactText } from './scenes/g3-exact-text'
import { g4ReusableLogo } from './scenes/g4-reusable-logo'
import { g5HistoricalContext } from './scenes/g5-historical-context'
import { g6ComicStrip } from './scenes/g6-comic-strip'
import { g7InterfacePreview } from './scenes/g7-interface-preview'
import { g8ScientificVisual } from './scenes/g8-scientific-visual'
import { g9SlidesCharts } from './scenes/g9-slides-charts'
import type { EditIntent, GenerationScene } from './types'

const GENERATION_SCENES: GenerationScene[] = [
  g1StyleLighting,
  g2ProcessInfographic,
  g3ExactText,
  g4ReusableLogo,
  g5HistoricalContext,
  g6ComicStrip,
  g7InterfacePreview,
  g8ScientificVisual,
  g9SlidesCharts,
]
const EDIT_INTENTS: EditIntent[] = [
  e1TranslateLayout,
  e2StyleTransfer,
  e3IdentityClothing,
  e4CombineRefs,
  e5TransparentCutout,
  e6DrawingToRealistic,
  e7RemoveObject,
  e8InsertPerson,
]

export { FUNDAMENTALS, formatFundamentalsBlock }
export function listGenerationScenes() { return GENERATION_SCENES }
export function listEditIntents() { return EDIT_INTENTS }
export function getGenerationScene(id: string) {
  return GENERATION_SCENES.find((s) => s.id === id)
}
export function getEditIntent(id: string) {
  return EDIT_INTENTS.find((i) => i.id === id)
}
