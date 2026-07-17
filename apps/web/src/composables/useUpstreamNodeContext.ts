import { computed, type Ref } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'

export interface CanvasEdgeLike {
  source: string
  target: string
}

export interface UpstreamNodeContext {
  /** 来自上游 text / prompt 节点的合并文案 */
  textPrompt: string
  /** 来自上游 image / mediaInput 的参考图 URL */
  referenceImageUrl: string
  /** 提供参考图的节点 id（若有） */
  referenceImageNodeId: string | null
  /** 所有上游 text/prompt 节点 id */
  textNodeIds: string[]
}

function nodeTextContent(node: EditableFlowNode): string {
  const data = node.data ?? {}
  const type = String(node.type ?? '')
  if (type === 'prompt') {
    return String(data.content ?? data.prompt ?? '').trim()
  }
  return String(data.content ?? data.prompt ?? '').trim()
}

function nodeMediaUrl(node: EditableFlowNode): string {
  const data = node.data ?? {}
  return String(data.url ?? '').trim()
}

function isTextSourceType(type: string): boolean {
  return type === 'text' || type === 'prompt'
}

function isImageSourceType(type: string): boolean {
  return type === 'image' || type === 'mediaInput'
}

export function resolveUpstreamContext(
  targetNodeId: string,
  nodes: EditableFlowNode[],
  edges: CanvasEdgeLike[],
): UpstreamNodeContext {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const textParts: string[] = []
  const textNodeIds: string[] = []
  let referenceImageUrl = ''
  let referenceImageNodeId: string | null = null

  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue
    const source = nodeMap.get(edge.source)
    if (!source) continue
    const type = String(source.type ?? '')

    if (isTextSourceType(type)) {
      const text = nodeTextContent(source)
      if (text) {
        textParts.push(text)
        textNodeIds.push(source.id)
      }
      continue
    }

    if (isImageSourceType(type)) {
      const url = nodeMediaUrl(source)
      if (url && !referenceImageUrl) {
        referenceImageUrl = url
        referenceImageNodeId = source.id
      }
    }
  }

  return {
    textPrompt: textParts.join('\n'),
    referenceImageUrl,
    referenceImageNodeId,
    textNodeIds,
  }
}

export function useUpstreamNodeContext(
  targetNodeId: Ref<string | null>,
  nodes: Ref<EditableFlowNode[]>,
  edges: Ref<CanvasEdgeLike[]>,
) {
  const upstream = computed((): UpstreamNodeContext => {
    const id = targetNodeId.value
    if (!id) {
      return { textPrompt: '', referenceImageUrl: '', referenceImageNodeId: null, textNodeIds: [] }
    }
    return resolveUpstreamContext(id, nodes.value, edges.value)
  })

  return { upstream }
}

/** 合并节点 data 与上游上下文，供生成时使用 */
export function mergePromptWithUpstream(
  nodeData: Record<string, unknown>,
  upstream: UpstreamNodeContext,
): string {
  const local = String(nodeData.prompt ?? nodeData.content ?? '').trim()
  if (local) return local
  return upstream.textPrompt.trim()
}

export function mergeReferenceImageUrl(
  nodeData: Record<string, unknown>,
  upstream: UpstreamNodeContext,
): string {
  const local = String(nodeData.referenceImageUrl ?? '').trim()
  if (local) return local
  return upstream.referenceImageUrl.trim()
}

export type VideoGenerationMode = 'text_to_video' | 'image_to_video'

export function resolveVideoMode(
  nodeData: Record<string, unknown>,
  upstream: UpstreamNodeContext,
): VideoGenerationMode {
  const explicit = nodeData.videoMode as VideoGenerationMode | undefined
  if (explicit === 'text_to_video' || explicit === 'image_to_video') return explicit
  const ref = mergeReferenceImageUrl(nodeData, upstream)
  return ref ? 'image_to_video' : 'text_to_video'
}

export function buildPromptWithRefImage(prompt: string, refImageUrl: string): string {
  const trimmed = prompt.trim()
  const ref = refImageUrl.trim()
  if (!ref) return trimmed
  return `${trimmed} [ref-image:${ref}]`
}
