import type { GenerationScene } from '../types'

/** P0 G1 — Control style and lighting (OpenAI Image prompting guide) */
export const g1StyleLighting: GenerationScene = {
  id: 'g1_style_lighting',
  kind: 'generation_scene',
  label: '风格与光线',
  description: 'Describe subject, framing, light, and texture; avoid heavy retouching.',
  groupId: 'photo_ad',
  groupLabel: '摄影/广告',
  fundamentalsRefs: ['define_result', 'visible_details', 'people_actions'],
  promptScaffold: `Create a photorealistic candid photograph of {{SUBJECT}}.
Describe framing (e.g. medium close-up at eye level), lens cues, and composition.
Lighting: {{LIGHT}} — soft/natural balance, shallow depth of field if needed.
Texture: real skin/material detail, subtle grain if film-like; honest and unposed.
No glamorization, no heavy retouching.`,
  systemOverlay:
    'Style & lighting scene: specify subject, framing, light, and texture. Prefer candid honesty; forbid heavy retouching and glamorization.',
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: {},
  expandViaPromptMode: 'image_prompt_multi_style',
}
