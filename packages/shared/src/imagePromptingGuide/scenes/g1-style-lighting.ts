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
  promptScaffold: `创作一张关于 {{SUBJECT}} 的写实抓拍照片。
写明取景（如平视中近景）、镜头感与构图。
光线：{{LIGHT}} — 柔和自然、层次清楚，需要时可浅景深。
质感：真实皮肤/材质细节，若偏胶片可带轻微颗粒；自然、不摆拍。
不要过度美化，不要重度修图。`,
  systemOverlay:
    'Style & lighting scene: specify subject, framing, light, and texture. Prefer candid honesty; forbid heavy retouching and glamorization.',
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: {},
  expandViaPromptMode: 'image_prompt_multi_style',
}
