export const FUNDAMENTALS = [
  { id: 'define_result', enTitle: 'Define the result', guidance: 'Name subject, intended use, composition, and constraints.' },
  { id: 'maintainable_format', enTitle: 'Choose a maintainable format', guidance: 'Prefer skimmable structure over clever syntax.' },
  { id: 'visible_details', enTitle: 'Describe visible details', guidance: 'Materials, lighting, colors, medium; say photorealistic explicitly when needed.' },
  { id: 'people_actions', enTitle: 'Specify people and actions', guidance: 'Body framing, gaze, and interaction with objects.' },
  { id: 'exact_text', enTitle: 'Specify exact text', guidance: 'Quote required wording; forbid extra text; check spelling.' },
  { id: 'separate_changes', enTitle: 'Separate changes from constraints', guidance: 'For edits: change only X; list what must stay.' },
  { id: 'assign_ref_roles', enTitle: 'Assign roles to references', guidance: 'Number each input by purpose: subject, style, clothing, background.' },
  { id: 'iterate', enTitle: 'Iterate deliberately', guidance: 'One change per turn; restate critical preserve constraints.' },
] as const

export function formatFundamentalsBlock(ids?: string[]): string {
  const set = ids?.length ? new Set(ids) : null
  const items = set ? FUNDAMENTALS.filter((f) => set.has(f.id)) : [...FUNDAMENTALS]
  return items.map((f) => `- ${f.enTitle}: ${f.guidance}`).join('\n')
}
