import type { GenerationScene } from '../types'

/** P0 G3 — Render exact text (OpenAI Image prompting guide) */
export const g3ExactText: GenerationScene = {
  id: 'g3_exact_text',
  kind: 'generation_scene',
  label: '精确文字',
  description: 'Quote required copy; render the tagline exactly once with no extra text.',
  fundamentalsRefs: ['define_result', 'exact_text', 'visible_details'],
  promptScaffold: `Create a polished campaign / fashion ad for a brand.
The ad features the subject with the tagline "{{TAGLINE}}".
Make it feel stylish and contemporary for the intended audience.
Use clean composition, strong color direction, and premium photography cues.
Render the tagline exactly once, clearly and legibly, integrated into the layout.
No extra text, no watermarks, no unrelated logos.`,
  systemOverlay:
    'Exact text scene: put required wording in quotes; render the tagline exactly once; no extra text, watermarks, or unrelated logos. Check spelling and legibility.',
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: {},
  expandViaPromptMode: 'image_prompt_multi_style',
}
