import type { DockNodeType } from '@/components/canvas/NodePanelDock.vue'

export interface CanvasDockMenuItem {
  type: DockNodeType
  label: string
  desc?: string
  badge?: string
  tone: string
}

export const CANVAS_DOCK_MENU_ITEMS: CanvasDockMenuItem[] = [
  { type: 'text', label: '文本', desc: '脚本、广告词、品牌文案', badge: 'Neo-G', tone: 'text-sky-300 bg-sky-500/15' },
  { type: 'image', label: '图片', desc: 'AI 图像生成', badge: 'Image', tone: 'text-emerald-300 bg-emerald-500/15' },
  { type: 'video', label: '视频', desc: '文生视频 / 图生视频', tone: 'text-violet-300 bg-violet-500/15' },
  { type: 'audio', label: '音频', desc: '配音与旁白', tone: 'text-cyan-300 bg-cyan-500/15' },
  { type: 'sceneComposer', label: '导演台', desc: '场景编排与预览', tone: 'text-amber-300 bg-amber-500/15' },
  { type: 'mediaInput', label: '媒体输入', desc: '上传图片 / 视频素材', tone: 'text-pink-300 bg-pink-500/15' },
  { type: 'videoComposition', label: '视频合成', desc: '多轨视频合成', tone: 'text-indigo-300 bg-indigo-500/15' },
  { type: 'worldModel', label: '3D World', desc: '生成可漫游的 3D 世界', badge: 'Beta', tone: 'text-orange-300 bg-orange-500/15' },
  { type: 'shot', label: '分镜', desc: '故事板分镜节点', tone: 'text-rose-300 bg-rose-500/15' },
  { type: 'group', label: '分组', desc: '组织多个节点', tone: 'text-white/70 bg-white/10' },
]

/** 从源节点拖出连线时可创建的目标类型（简化规则，后续可按 Neo 细化） */
export const CONNECT_OUT_TARGET_TYPES: DockNodeType[] = [
  'text',
  'image',
  'video',
  'audio',
  'sceneComposer',
  'shot',
  'mediaInput',
  'videoComposition',
  'worldModel',
]
