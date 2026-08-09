import type { Session } from '@lnkpi/shared'

type CanvasNodeLike = {
  type?: string
  data?: { url?: string; coverUrl?: string }
}

const MEDIA_NODE_TYPES = new Set(['image', 'video', 'mediaInput', 'shot'])

export function extractSessionCover(session: Session): { url: string; kind: 'image' | 'video' } | null {
  const nodes = (session.canvasData?.nodes ?? []) as CanvasNodeLike[]
  for (const node of nodes) {
    const type = String(node.type ?? '')
    const url = String(node.data?.coverUrl ?? node.data?.url ?? '').trim()
    if (!url) continue
    if (type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(url)) {
      return { url, kind: 'video' }
    }
    if (MEDIA_NODE_TYPES.has(type) || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url)) {
      return { url, kind: 'image' }
    }
  }
  for (const node of nodes) {
    const url = String(node.data?.coverUrl ?? node.data?.url ?? '').trim()
    if (url) return { url, kind: 'image' }
  }
  return null
}
