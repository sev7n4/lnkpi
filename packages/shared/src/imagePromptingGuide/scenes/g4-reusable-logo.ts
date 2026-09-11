import type { GenerationScene } from '../types'

/** G4 — Reusable logo */
export const g4ReusableLogo: GenerationScene = {
  id: 'g4_reusable_logo',
  kind: 'generation_scene',
  label: '可复用 Logo',
  description: 'Create a simple, reusable logo mark with a clean transparent background.',
  groupId: 'brand_ui',
  groupLabel: '品牌/UI',
  fundamentalsRefs: ['define_result', 'visible_details', 'exact_text'],
  promptScaffold: `Create a distinctive, reusable logo for {{BRAND}}.
Use a simple silhouette, balanced geometry, and a limited color palette that works at small sizes.
If lettering is requested, render "{{LOGOTYPE}}" exactly once and keep it legible.
Isolate the logo on a fully transparent background with crisp, clean edges.
Do not add mockups, scenery, shadows, extra text, or watermarks.`,
  preferredParams: {
    size: '1024x1024',
    quality: 'medium',
    background: 'transparent',
    outputFormat: 'png',
  },
  capability: { requiresTransparentBackground: true },
}
