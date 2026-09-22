import { seedImageVersions } from '@lnkpi/shared'

export interface RefineApplyAsChildInput {
  sourceNode: { id: string; position: { x: number; y: number } }
  result: {
    url: string
    prompt: string
    recordId?: string
    appliedKey: string
    nodeSize?: { width: number; height: number }
  }
  addNode: (
    type: 'image',
    data: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ) => string
  addEdge: (edge: { id: string; source: string; target: string }) => void
  findAppliedNode: (key: string) => { id: string } | undefined
  /** 默认节点框尺寸（当前实现未直接消费，保留以对齐 brief 签名）。 */
  defaultBox?: { width: number; height: number }
}

/** 新节点相对源节点右侧的横向间距（px）。 */
const CHILD_OFFSET_X = 40

/**
 * 把精修结果作为「下游新节点」接入画布（不覆盖源节点）。
 *
 * 幂等：findAppliedNode(appliedKey) 命中 → 直接返回已有节点、不建节点不加边。
 * 未命中 → addNode('image', data) + addEdge，position 取源节点右侧偏移
 * （横向 40px，纵向对齐源节点 top），返回 { nodeId, created: true }。
 *
 * 红线：本函数对 sourceNode 仅做只读位置派生，绝不存在任何写回源节点 data/position 的路径。
 */
export function applyRefineAsChild(
  input: RefineApplyAsChildInput,
): { nodeId: string; created: boolean } {
  const found = input.findAppliedNode(input.result.appliedKey)
  if (found) return { nodeId: found.id, created: false }

  const nodeId = input.addNode(
    'image',
    {
      url: input.result.url,
      prompt: input.result.prompt,
      generationRecordId: input.result.recordId,
      status: 'completed',
      appliedKey: input.result.appliedKey,
      nodeSize: input.result.nodeSize,
      imageVersions: seedImageVersions({
        url: input.result.url,
        generationRecordId: input.result.recordId,
      }).imageVersions,
    },
    {
      position: {
        x: input.sourceNode.position.x + CHILD_OFFSET_X,
        y: input.sourceNode.position.y,
      },
    },
  )

  input.addEdge({
    id: `e-${input.sourceNode.id}-${nodeId}`,
    source: input.sourceNode.id,
    target: nodeId,
  })

  return { nodeId, created: true }
}
