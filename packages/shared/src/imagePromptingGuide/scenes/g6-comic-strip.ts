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
  promptScaffold: `创作一套 {{PANEL_COUNT}} 格漫画，讲述 {{STORY}}。
人物、服装、道具与场景在各格保持视觉一致。
每格有独立情节推进、清晰动作与明确阅读顺序。
所给对白须精确写入可读气泡。
不要额外分格、对白、logo 或水印。`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
  expandViaPromptMode: 'storyboard',
}
