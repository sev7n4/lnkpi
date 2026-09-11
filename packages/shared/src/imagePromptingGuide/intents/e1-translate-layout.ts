import type { EditIntent } from '../types'

/** E1 — Translate layout */
export const e1TranslateLayout: EditIntent = {
  id: 'e1_translate_layout',
  kind: 'edit_intent',
  label: '版面翻译',
  description: 'Translate visible copy while preserving the original layout and visual design.',
  groupId: 'local_edit',
  groupLabel: '局部手术',
  fundamentalsRefs: ['exact_text', 'separate_changes', 'iterate'],
  changePreserveTemplate: `Translate the visible text in the input image into {{TARGET_LANGUAGE}}.
Replace only the original text and render the supplied translation exactly.
Preserve layout, hierarchy, font character, colors, spacing, imagery, logos, and background.
Fit translated copy naturally without clipping or overlap.
Do not add, remove, or redesign any other element.`,
  refRoles: [{ role: 'source', required: true, hint: '待翻译的原版面' }],
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: { minRefImages: 1 },
}
