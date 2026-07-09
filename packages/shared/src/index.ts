export type WorkType = 'canvas' | 'shortfilm'

export type NodeType = 'prompt' | 'image' | 'video' | 'text' | 'group'

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
