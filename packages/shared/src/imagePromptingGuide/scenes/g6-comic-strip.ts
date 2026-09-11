import type { GenerationScene } from '../types'

/** G6 — Comic strip */
export const g6ComicStrip: GenerationScene = {
  id: 'g6_comic_strip',
  kind: 'generation_scene',
  label: '故事漫画分格',
  description: 'Tell a coherent short story through ordered comic panels.',
  groupId: 'narrative',
  groupLabel: '叙事',
  fundamentalsRefs: ['define_result', 'maintainable_format', 'people_actions', 'exact_text'],
  promptScaffold: `Create a {{PANEL_COUNT}}-panel comic strip about {{STORY}}.
Keep characters, clothing, props, and setting visually consistent across panels.
Give each panel a distinct story beat, clear action, and an obvious reading order.
Render supplied dialogue exactly in readable speech balloons.
Do not add extra panels, dialogue, logos, or watermarks.`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
  expandViaPromptMode: 'storyboard',
}
