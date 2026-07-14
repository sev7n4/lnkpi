export type WorkType = 'canvas' | 'shortfilm'

export type NodeType = 'prompt' | 'image' | 'video' | 'text' | 'group' | 'shot' | 'sceneComposer'

export * from './sceneComposer'

export type GenerationType = 'text' | 'image' | 'video'

export interface AIModel {
  id: string
  name: string
  provider: string
  type: GenerationType
}

export interface User {
  id: string
  phone: string
  nickname: string
  avatar?: string
  points?: number
  membership?: string
  createdAt: string
}

export interface Session {
  id: string
  title: string
  userId: string
  canvasData?: CanvasData
  createdAt: string
  updatedAt: string
}

export interface Work {
  id: string
  title: string
  coverUrl: string
  type: WorkType
  authorId: string
  authorName: string
  authorAvatar?: string
  sessionId?: string
  likes: number
  views: number
  category?: string
  createdAt: string
}

export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface LoginRequest {
  phone: string
  code: string
}

export interface AuthToken {
  token: string
  user: User
}

export interface CreateSessionRequest {
  title?: string
  prompt?: string
}

export interface CanvasNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
}

export interface CanvasData {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport?: { x: number; y: number; zoom: number }
}

export interface GenerationRequest {
  sessionId: string
  nodeId?: string
  type: GenerationType
  prompt: string
  modelId: string
  params?: Record<string, unknown>
}

export interface GenerationResult {
  id: string
  type: GenerationType
  status: 'pending' | 'processing' | 'completed' | 'failed'
  outputUrl?: string
  outputText?: string
  error?: string
}

export const WORK_CATEGORIES = ['全部', '2026-赛事', '精选作品', '短片', '画布'] as const

export type WorkCategory = (typeof WORK_CATEGORIES)[number]

export const TEXT_MODELS: AIModel[] = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', type: 'text' },
  { id: 'deepseek-v3', name: 'DeepSeek V3', provider: 'DeepSeek', type: 'text' },
  { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'Anthropic', type: 'text' },
]

export const IMAGE_MODELS: AIModel[] = [
  { id: 'dall-e-3', name: 'DALL·E 3', provider: 'OpenAI', type: 'image' },
  { id: 'midjourney-v6', name: 'Midjourney V6', provider: 'Midjourney', type: 'image' },
  { id: 'flux-pro', name: 'Flux Pro', provider: 'Black Forest', type: 'image' },
  { id: 'sd-xl', name: 'Stable Diffusion XL', provider: 'Stability', type: 'image' },
]

export const VIDEO_MODELS: AIModel[] = [
  { id: 'sora', name: 'Sora', provider: 'OpenAI', type: 'video' },
  { id: 'kling-v1', name: '可灵 V1', provider: 'Kuaishou', type: 'video' },
  { id: 'runway-gen3', name: 'Runway Gen-3', provider: 'Runway', type: 'video' },
  { id: 'pika-v2', name: 'Pika V2', provider: 'Pika', type: 'video' },
]

export type VideoAspectRatio = '16:9' | '9:16' | '1:1'
export type VideoCropMode = 'none' | 'center' | 'fill'

export interface VideoSettings {
  aspectRatio: VideoAspectRatio
  duration: 5 | 10 | 15
  crop: VideoCropMode
}

export const VIDEO_ASPECT_RATIO_OPTIONS: { value: VideoAspectRatio; label: string }[] = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方形' },
]

export const VIDEO_DURATION_OPTIONS: { value: 5 | 10 | 15; label: string }[] = [
  { value: 5, label: '5 秒' },
  { value: 10, label: '10 秒' },
  { value: 15, label: '15 秒' },
]

export const VIDEO_CROP_OPTIONS: { value: VideoCropMode; label: string }[] = [
  { value: 'none', label: '不裁剪' },
  { value: 'center', label: '居中裁剪' },
  { value: 'fill', label: '填充裁剪' },
]

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspectRatio: '16:9',
  duration: 5,
  crop: 'none',
}

// --- Shot/Material 模型（对标 NeoWOW Canvas Domain）---

export type ShotStatus = 'draft' | 'generating' | 'generated' | 'failed'
export type MaterialType = 'image' | 'video' | 'audio'
export type MaterialStatus = 'idle' | 'generating' | 'completed' | 'failed'

export interface Material {
  id: string
  shotId: string
  type: MaterialType
  url?: string
  thumbnail?: string
  prompt?: string
  status: MaterialStatus
  order: number
}

export interface Shot {
  id: string
  sessionId: string
  title: string
  prompt: string
  order: number
  status: ShotStatus
  position: { x: number; y: number }
  materials: Material[]
}

// --- Agent 驱动画布 ---

export type CanvasActionType = 'add_node' | 'update_node' | 'remove_node' | 'add_edge' | 'remove_edge' | 'set_viewport'

export interface CanvasAction {
  type: CanvasActionType
  payload: {
    id?: string
    nodeType?: NodeType
    position?: { x: number; y: number }
    data?: Record<string, unknown>
    source?: string
    target?: string
    parentShotId?: string
    viewport?: { x: number; y: number; zoom: number }
  }
}

export interface AgentChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: string
  createdAt: string
}

export interface CapabilityItem {
  id: string
  name: string
  type: GenerationType
  provider: string
  description?: string
}
