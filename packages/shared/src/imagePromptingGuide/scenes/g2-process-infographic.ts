import type { GenerationScene } from '../types'

/** G2 — Process infographic */
export const g2ProcessInfographic: GenerationScene = {
  id: 'g2_process_infographic',
  kind: 'generation_scene',
  label: '流程信息图',
  description: 'Turn a sequence into a clear, ordered infographic with concise labels.',
  groupId: 'info_design',
  groupLabel: '信息设计',
  fundamentalsRefs: ['define_result', 'maintainable_format', 'exact_text'],
  promptScaffold: `Create a clean process infographic explaining {{PROCESS}}.
Show the steps in an obvious reading order with numbered stages and concise labels.
Use consistent icons, spacing, connectors, and a restrained color palette.
Render all supplied wording exactly and keep the hierarchy legible.
Do not add unsupported steps, decorative copy, logos, or watermarks.`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
}
