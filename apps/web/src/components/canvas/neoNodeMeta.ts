export type NeoNodeStatus = 'idle' | 'running' | 'success' | 'error'

export interface NeoNodeMeta {
  label: string
  variant: string
  icon: 'prompt' | 'text' | 'image' | 'video' | 'audio' | 'input' | 'shot' | 'director' | 'composition' | 'world' | 'group'
  defaultWidth: number
  defaultHeight: number
}

export const NEO_NODE_META: Record<string, NeoNodeMeta> = {
  prompt: { label: '提示词', variant: 'node-prompt', icon: 'prompt', defaultWidth: 280, defaultHeight: 120 },
  text: { label: '文本', variant: 'node-text', icon: 'text', defaultWidth: 280, defaultHeight: 160 },
  image: { label: '图片', variant: 'node-image', icon: 'image', defaultWidth: 280, defaultHeight: 280 },
  video: { label: '视频', variant: 'node-video', icon: 'video', defaultWidth: 280, defaultHeight: 280 },
  audio: { label: '音频', variant: 'node-audio', icon: 'audio', defaultWidth: 280, defaultHeight: 140 },
  mediaInput: { label: '媒体输入', variant: 'node-input', icon: 'input', defaultWidth: 280, defaultHeight: 280 },
  shot: { label: '分镜', variant: 'node-generation', icon: 'shot', defaultWidth: 280, defaultHeight: 280 },
  sceneComposer: { label: '导演台', variant: 'node-generation', icon: 'director', defaultWidth: 280, defaultHeight: 280 },
  videoComposition: { label: '视频合成', variant: 'node-generation', icon: 'composition', defaultWidth: 280, defaultHeight: 200 },
  worldModel: { label: '3D World', variant: 'node-generation', icon: 'world', defaultWidth: 280, defaultHeight: 280 },
  group: { label: '分组', variant: 'node-group', icon: 'group', defaultWidth: 280, defaultHeight: 160 },
}

export function getNeoNodeMeta(type: string): NeoNodeMeta {
  return NEO_NODE_META[type] ?? {
    label: '节点',
    variant: 'node-generation',
    icon: 'text',
    defaultWidth: 280,
    defaultHeight: 280,
  }
}

export function resolveNeoNodeStatus(status?: string): NeoNodeStatus {
  const value = String(status ?? '').toLowerCase()
  if (['generating', 'pending', 'processing', 'running'].includes(value)) return 'running'
  if (['generated', 'success', 'done', 'completed'].includes(value)) return 'success'
  if (['failed', 'error'].includes(value)) return 'error'
  return 'idle'
}

export function resolveNeoNodeTitle(type: string, data?: Record<string, unknown>) {
  const meta = getNeoNodeMeta(type)
  const custom = String(data?.label ?? data?.title ?? '').trim()
  if (custom) return custom.length > 20 ? `${custom.slice(0, 20)}...` : custom
  return meta.label
}
