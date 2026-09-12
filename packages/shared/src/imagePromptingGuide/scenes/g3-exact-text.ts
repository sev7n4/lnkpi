import type { GenerationScene } from '../types'

/** P0 G3 — Render exact text (OpenAI Image prompting guide) */
export const g3ExactText: GenerationScene = {
  id: 'g3_exact_text',
  kind: 'generation_scene',
  label: '精确文字',
  description: 'Quote required copy; render the tagline exactly once with no extra text.',
  groupId: 'photo_ad',
  groupLabel: '摄影/广告',
  fundamentalsRefs: ['define_result', 'exact_text', 'visible_details'],
  promptScaffold: `创作一张精致的品牌/时尚广告图。
画面主体搭配标语「{{TAGLINE}}」。
风格时尚、当代，面向目标受众。
构图干净，色彩方向明确，摄影质感高级。
标语只出现一次，清晰可读并融入版面。
不要多余文字、水印或无关 logo。`,
  systemOverlay:
    'Exact text scene: put required wording in quotes; render the tagline exactly once; no extra text, watermarks, or unrelated logos. Check spelling and legibility.',
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: {},
  expandViaPromptMode: 'image_prompt_multi_style',
}
