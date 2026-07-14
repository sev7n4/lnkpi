/** Dock Studio 可编辑节点类型与策略（Sprint A / P0-6） */

export const EDITABLE_NODE_TYPES = new Set([
  'text',
  'image',
  'video',
  'audio',
  'sceneComposer',
  'shot',
  'prompt',
  'mediaInput',
  'videoComposition',
])

/** 使用独立 Dock Panel 的节点 */
export const DOCK_PANEL_NODE_TYPES = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  shot: 'shot',
  mediaInput: 'mediaInput',
  sceneComposer: 'sceneComposer',
  videoComposition: 'videoComposition',
} as const

export type DockPanelNodeType = keyof typeof DOCK_PANEL_NODE_TYPES

export function isDockPanelNodeType(type: string): type is DockPanelNodeType {
  return type in DOCK_PANEL_NODE_TYPES
}

/** 节点生成状态机（P0-4） */
export const NODE_GENERATION_STATUS = {
  draft: 'draft',
  generating: 'generating',
  completed: 'completed',
  error: 'error',
  failed: 'failed',
} as const

export type NodeGenerationStatus = (typeof NODE_GENERATION_STATUS)[keyof typeof NODE_GENERATION_STATUS]

export function isNodeGenerating(status: unknown): boolean {
  return status === NODE_GENERATION_STATUS.generating
}
