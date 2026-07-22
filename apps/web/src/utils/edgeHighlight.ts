export function annotateEdgesForSelection<T extends { id: string; class?: string }>(
  edges: T[],
  upstream: Set<string>,
  downstream: Set<string>,
): T[] {
  return edges.map((edge) => {
    if (upstream.has(edge.id)) return { ...edge, class: 'neo-edge-upstream' }
    if (downstream.has(edge.id)) return { ...edge, class: 'neo-edge-downstream' }
    return { ...edge, class: undefined }
  })
}
