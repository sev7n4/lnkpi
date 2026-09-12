import {
  IMPORT_NODE_ESTIMATE,
  type NodeLike,
  type Rect,
  type Size,
  unionNodeBBox,
} from './workflowImportPlacement'

export type MeasuredNode = {
  id: string
  dimensions?: { width: number; height: number }
}

export type FitImportedViewportDeps = {
  ids: string[]
  nodes: NodeLike[]
  getMeasuredNode: (id: string) => MeasuredNode | undefined
  fitView: (opts: {
    nodes: string[]
    padding: number
    duration: number
  }) => Promise<boolean | void>
  fitBounds: (
    bounds: Rect,
    opts: { padding: number; duration: number },
  ) => Promise<unknown>
  updateNodeInternals?: (ids: string[]) => void
  wait?: () => Promise<void>
  maxAttempts?: number
  estimate?: Size
  padding?: number
  duration?: number
}

function hasDimensions(node: MeasuredNode | undefined): boolean {
  return Boolean(node?.dimensions?.width && node?.dimensions?.height)
}

async function defaultWait() {
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 0)
    }
  })
}

/**
 * Vue Flow's fitView skips nodes without measured dimensions.
 * After a fresh import, one nextTick is often too early — wait briefly,
 * then fall back to fitBounds using estimated sizes from positions.
 */
export async function fitImportedViewport(
  deps: FitImportedViewportDeps,
): Promise<'fitView' | 'fitBounds' | 'none'> {
  const ids = deps.ids.filter(Boolean)
  if (!ids.length) return 'none'

  const padding = deps.padding ?? 0.2
  const duration = deps.duration ?? 300
  const maxAttempts = deps.maxAttempts ?? 12
  const wait = deps.wait ?? defaultWait
  const estimate = deps.estimate ?? IMPORT_NODE_ESTIMATE

  deps.updateNodeInternals?.(ids)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await wait()
    const measured = ids.some((id) => hasDimensions(deps.getMeasuredNode(id)))
    if (!measured && attempt < maxAttempts - 1) continue

    const ok = await deps.fitView({ nodes: ids, padding, duration })
    if (ok !== false) return 'fitView'
    if (measured) break
  }

  const idSet = new Set(ids)
  const scoped = deps.nodes.filter((n) => idSet.has(n.id))
  const bounds = unionNodeBBox(scoped, estimate)
  if (!bounds) return 'none'

  await deps.fitBounds(bounds, { padding, duration })
  return 'fitBounds'
}
