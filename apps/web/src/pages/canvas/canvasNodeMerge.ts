/** Prefer server url/content/status over stale local empty values. */

export type MergeNode = {
  id: string
  type?: string
  data?: Record<string, unknown> | null
}

export function mergeCanvasNodesFromServer<T extends MergeNode>(
  local: T[],
  server: T[],
): T[] {
  const serverById = new Map(server.map((n) => [n.id, n]))
  const merged = local.map((ln) => {
    const sn = serverById.get(ln.id)
    if (!sn) return ln
    const ld = { ...(ln.data || {}) }
    const sd = sn.data || {}
    const sUrl = typeof sd.url === 'string' ? sd.url : ''
    const lUrl = typeof ld.url === 'string' ? ld.url : ''
    if (sUrl && (!lUrl || lUrl !== sUrl)) {
      ld.url = sUrl
      if (sd.status != null) ld.status = sd.status
      if (sd.generationRecordId != null) ld.generationRecordId = sd.generationRecordId
    }
    const sContent = typeof sd.content === 'string' ? sd.content.trim() : ''
    const lContent = typeof ld.content === 'string' ? ld.content.trim() : ''
    if (sContent && sContent !== lContent) {
      ld.content = sd.content
      if (sd.status != null) ld.status = sd.status
    }
    if (!sUrl && sd.status === 'generating') {
      ld.status = 'generating'
      if (sd.generationRecordId != null) ld.generationRecordId = sd.generationRecordId
    }
    return { ...ln, data: ld }
  })
  // Append server-only nodes (e.g. new split skeletons)
  const localIds = new Set(local.map((n) => n.id))
  for (const sn of server) {
    if (!localIds.has(sn.id)) merged.push(sn)
  }
  return merged
}
