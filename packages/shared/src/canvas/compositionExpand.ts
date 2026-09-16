import type { LocalRefBinding } from '../nodeRefs'
import type { CompositionIR } from './compositionIr'
import {
  I0_SKELETON_PROMPT,
  LOOK_SKELETON_PROMPT,
  P_SKELETON_PROMPT,
  renderCompositionCopy,
} from './compositionCopy'
import { buildWorkflowDocument, type WorkflowDocument } from './workflowExchange'

export { renderCompositionCopy }

type DraftNode = {
  id: string
  type: string
  dependsOn: string[]
  data: Record<string, unknown>
}

function srcId(ref: string): string {
  return `image-src-${ref}`
}

function lookId(index: number): string {
  return `image-look-${index}`
}

function slot(copy: NonNullable<CompositionIR['copy']>, key: string): string | undefined {
  const fromPrompt = copy.promptSlots?.[key]
  if (typeof fromPrompt === 'string' && fromPrompt.trim()) return fromPrompt
  return undefined
}

function titleOf(copy: NonNullable<CompositionIR['copy']>, key: string, fallback: string): string {
  const value = copy.titles?.[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

function sourceNode(
  ref: string,
  title: string,
  localRefsByRef: Record<string, LocalRefBinding[]> | undefined,
): DraftNode {
  const data: Record<string, unknown> = {
    title,
    prompt: '',
    status: 'draft',
    // inferMediaRole → uploaded (source images are visible uploads, never generated)
    imageVersions: [{ source: 'upload' }],
  }
  const localRefs = localRefsByRef?.[ref]
  if (localRefs && localRefs.length > 0) data.localRefs = localRefs
  return {
    id: srcId(ref),
    type: 'image',
    dependsOn: [],
    data,
  }
}

function imageGenNode(
  id: string,
  title: string,
  prompt: string,
  mentionedKeys: string[],
): DraftNode {
  return {
    id,
    type: 'image',
    dependsOn: mentionedKeys,
    data: {
      title,
      prompt,
      status: 'draft',
      genMode: 'i2i',
      mentionedKeys,
    },
  }
}

function topologicalLayers(nodes: DraftNode[]): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const memo = new Map<string, number>()

  const layerOf = (id: string, visiting: Set<string>): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    const node = byId.get(id)
    let layer = 0
    if (node) {
      for (const dep of node.dependsOn) {
        layer = Math.max(layer, layerOf(dep, visiting) + 1)
      }
    }
    visiting.delete(id)
    memo.set(id, layer)
    return layer
  }

  for (const node of nodes) layerOf(node.id, new Set())
  return memo
}

function toWorkflow(drafts: DraftNode[]): WorkflowDocument {
  const layers = topologicalLayers(drafts)
  const indexInLayer = new Map<string, number>()
  const layerCounts = new Map<number, number>()
  for (const node of drafts) {
    const layer = layers.get(node.id) ?? 0
    const index = layerCounts.get(layer) ?? 0
    indexInLayer.set(node.id, index)
    layerCounts.set(layer, index + 1)
  }

  const nodes = drafts.map((node) => {
    const layer = layers.get(node.id) ?? 0
    const index = indexInLayer.get(node.id) ?? 0
    return {
      id: node.id,
      type: node.type,
      position: {
        x: 80 + layer * 360,
        y: 120 + index * 220,
      },
      data: node.data,
    }
  })

  const edges: Array<{ id: string; source: string; target: string }> = []
  for (const node of drafts) {
    for (const source of node.dependsOn) {
      edges.push({
        id: `e-${source}-${node.id}`,
        source,
        target: node.id,
      })
    }
  }

  return buildWorkflowDocument({
    nodes,
    edges,
    mode: 'full',
    exportMode: 'lightweight',
    mediaIndex: [],
  })
}

export function expandComposition(
  ir: CompositionIR,
  localRefsByRef?: Record<string, LocalRefBinding[]>,
): WorkflowDocument {
  const copy = ir.copy ?? {}
  const { identityRef, garmentRefs, wantVideo } = ir.primitives
  const skipI0 = Boolean(ir.primitives.skipI0)
  const tryOn = Boolean(identityRef) && garmentRefs.length > 0
  const drafts: DraftNode[] = []

  if (identityRef) {
    drafts.push(sourceNode(identityRef, titleOf(copy, `src-${identityRef}`, '模特源图'), localRefsByRef))
  }

  if (tryOn && identityRef) {
    const identityAnchor = skipI0 ? srcId(identityRef) : 'image-i0'
    if (!skipI0) {
      drafts.push(
        imageGenNode(
          'image-i0',
          titleOf(copy, 'i0', '清晰白底三视图'),
          slot(copy, 'i0') ?? I0_SKELETON_PROMPT,
          [srcId(identityRef)],
        ),
      )
    }

    for (const ref of garmentRefs) {
      drafts.push(sourceNode(ref, titleOf(copy, `src-${ref}`, '服装图'), localRefsByRef))
    }

    for (let i = 0; i < garmentRefs.length; i++) {
      const mentionedKeys = [identityAnchor, srcId(garmentRefs[i])]
      drafts.push(
        imageGenNode(
          lookId(i),
          titleOf(copy, `look-${i}`, `换装造型 ${i + 1}`),
          slot(copy, `look-${i}`) ?? LOOK_SKELETON_PROMPT,
          mentionedKeys,
        ),
      )
    }

    if (wantVideo) {
      appendVideo(drafts, copy, [identityAnchor, ...garmentRefs.map((_, i) => lookId(i))])
    }
    return toWorkflow(drafts)
  }

  // Conservative graph: identity-only and/or wantVideo-only. Gold-2 sequence
  // expand is Task 3; do not throw.
  if (wantVideo) {
    appendVideo(drafts, copy, identityRef ? [srcId(identityRef)] : [])
  }
  return toWorkflow(drafts)
}

function appendVideo(
  drafts: DraftNode[],
  copy: NonNullable<CompositionIR['copy']>,
  imageKeys: string[],
): void {
  const pPrompt = copy.pSlots?.p || slot(copy, 'p') || P_SKELETON_PROMPT
  drafts.push({
    id: 'text-p',
    type: 'text',
    dependsOn: [],
    data: {
      title: titleOf(copy, 'p', '换装分镜'),
      prompt: pPrompt,
      status: 'draft',
    },
  })
  drafts.push({
    id: 'video-v',
    type: 'video',
    dependsOn: [...imageKeys, 'text-p'],
    data: {
      title: titleOf(copy, 'v', '成片'),
      prompt: '',
      status: 'draft',
      genMode: 'v_ref',
      ...(imageKeys.length > 0 ? { mentionedKeys: imageKeys } : {}),
    },
  })
}
