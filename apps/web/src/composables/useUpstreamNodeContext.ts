import { computed, type Ref } from 'vue'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import { resolveNodeRefs } from '@/composables/useNodeRefs'

export interface CanvasEdgeLike {
  id?: string
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

function normalizeEdges(
  edges: CanvasEdgeLike[],
): Array<{ id: string; source: string; target: string }> {
  return edges.map((edge) => ({
    id: edge.id ?? `${edge.source}->${edge.target}`,
    source: edge.source,
    target: edge.target,
  }))
}

export function resolveUpstreamContext(
  targetNodeId: string,
  nodes: EditableFlowNode[],
  edges: CanvasEdgeLike[],
): UpstreamNodeContext {
  const targetNode = nodes.find((n) => n.id === targetNodeId)
  const targetType = String(targetNode?.type ?? '')

  const refs = resolveNodeRefs({
    targetNodeId,
    targetType,
    nodes,
    edges: normalizeEdges(edges),
  })

  const textRefs = refs.filter((r) => r.mediaType === 'text' && !r.stale)
  const imageRefs = refs.filter((r) => r.mediaType === 'image' && !r.stale)

  return {
    textPrompt: textRefs
      .map((r) => r.payload.text)
      .filter(Boolean)
      .join('\n'),
    referenceImageUrl: imageRefs[0]?.payload.url ?? '',
    referenceImageNodeId: imageRefs[0]?.sourceNodeId ?? null,
    textNodeIds: textRefs.map((r) => r.sourceNodeId!).filter(Boolean),
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
