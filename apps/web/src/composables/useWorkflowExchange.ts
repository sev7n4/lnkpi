import JSZip from 'jszip'
import { ElMessage } from 'element-plus'
import {
  buildWorkflowDocument,
  getGroupChildIds,
  remapWorkflowIds,
  validateWorkflow,
  type MediaIndexEntry,
  type WorkflowDocument,
} from '@lnkpi/shared'
import {
  collectMediaFromNodes,
  downloadMediaPackage,
  fetchMediaBlob,
  triggerBlobDownload,
  type DownloadMediaOptions,
} from './useCanvasMedia'

export type WorkflowExportMode = 'full_package' | 'lightweight' | 'media_list_only'

export interface WorkflowExportNode {
  id: string
  type?: string
  position: { x: number; y: number }
  parentId?: string
  parentNode?: string
  data?: Record<string, unknown>
}

export interface WorkflowExportEdge {
  id: string
  source: string
  target: string
}

export interface ExportWorkflowPackageOptions {
  nodes: WorkflowExportNode[]
  edges: WorkflowExportEdge[]
  selectedIds: string[]
  sessionId?: string
  exportMode: WorkflowExportMode
}

export interface ExportWorkflowPackageResult {
  ok: boolean
  mediaOk: number
  mediaFail: number
}

export interface ImportWorkflowPackageContext {
  nodes: WorkflowExportNode[]
  edges: WorkflowExportEdge[]
  sessionId?: string
  applyMerge: (
    nodes: WorkflowExportNode[],
    edges: WorkflowExportEdge[],
  ) => void | Promise<void>
  createId?: (type: string) => string
  uploadMedia?: (file: File) => Promise<string>
}

export interface ImportWorkflowPackageResult {
  addedNodes: number
  idMap: Record<string, string>
}

const IMPORT_POSITION_OFFSET = 80

function defaultCreateIdFactory(existingNodes: WorkflowExportNode[]): (type: string) => string {
  const used = new Set(existingNodes.map((n) => n.id))
  let counter = 0
  const stamp = Date.now()
  return (type: string) => {
    let id: string
    do {
      counter += 1
      id = `${type}-imp-${stamp}-${counter}`
    } while (used.has(id))
    used.add(id)
    return id
  }
}

async function parseWorkflowFile(file: File): Promise<{
  doc: WorkflowDocument
  zip: JSZip | null
}> {
  const name = file.name.toLowerCase()
  const isZip =
    name.endsWith('.zip') ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed'

  if (isZip) {
    const zip = await JSZip.loadAsync(file)
    const workflowEntry = zip.file('workflow.json')
    if (!workflowEntry) {
      throw new Error('压缩包缺少 workflow.json')
    }
    const text = await workflowEntry.async('string')
    const raw = JSON.parse(text) as unknown
    return { doc: validateWorkflow(raw), zip }
  }

  const text = await file.text()
  const raw = JSON.parse(text) as unknown
  return { doc: validateWorkflow(raw), zip: null }
}

async function uploadZipMedia(
  zip: JSZip,
  remapped: WorkflowDocument,
  uploadMedia: (file: File) => Promise<string>,
): Promise<void> {
  const byNodeId = new Map(remapped.graph.nodes.map((n) => [n.id, n]))
  for (const entry of remapped.mediaIndex) {
    if (!entry.path) continue
    const zipFile = zip.file(entry.path)
    if (!zipFile) continue
    const blob = await zipFile.async('blob')
    const file = new File([blob], entry.fileName || entry.path.split('/').pop() || 'media.bin', {
      type: blob.type || 'application/octet-stream',
    })
    const url = await uploadMedia(file)
    const node = byNodeId.get(entry.nodeId)
    if (node) {
      node.data = { ...node.data, url }
    }
  }
}

function toMergeNodes(doc: WorkflowDocument): WorkflowExportNode[] {
  return doc.graph.nodes.map((node) => {
    const parent = node.parentNode ?? node.parentId
    return {
      id: node.id,
      type: node.type,
      position: {
        x: node.position.x + IMPORT_POSITION_OFFSET,
        y: node.position.y + IMPORT_POSITION_OFFSET,
      },
      ...(parent !== undefined ? { parentNode: parent } : {}),
      data: { ...node.data },
    }
  })
}

function expandExportNodeIds(nodes: WorkflowExportNode[], selectedIds: string[]): string[] {
  if (!selectedIds.length) return nodes.map((n) => n.id)
  const set = new Set(selectedIds)
  for (const id of [...set]) {
    const node = nodes.find((entry) => entry.id === id)
    if (node?.type !== 'group') continue
    for (const childId of getGroupChildIds(nodes, id)) {
      set.add(childId)
    }
  }
  return [...set]
}

function toastExportResult(mediaOk: number, mediaFail: number) {
  if (mediaFail > 0) {
    ElMessage.warning(`工作流已导出：媒体成功 ${mediaOk} / 失败 ${mediaFail}`)
  } else if (mediaOk > 0) {
    ElMessage.success(`工作流已导出：媒体 ${mediaOk} 个`)
  } else {
    ElMessage.success('工作流已导出')
  }
}

export async function exportWorkflowPackage(
  opts: ExportWorkflowPackageOptions,
): Promise<ExportWorkflowPackageResult> {
  const { nodes, edges, selectedIds, sessionId, exportMode } = opts

  if (exportMode === 'media_list_only') {
    const ids = selectedIds.length ? selectedIds : nodes.map((n) => n.id)
    const count = await downloadMediaPackage(
      nodes.map((n) => ({ id: n.id, type: n.type, data: n.data ?? {} })),
      ids,
      sessionId ? { sessionId } : undefined,
    )
    return { ok: true, mediaOk: count, mediaFail: 0 }
  }

  const idSet = new Set(expandExportNodeIds(nodes, selectedIds))
  const scopedNodes = nodes.filter((n) => idSet.has(n.id))
  const scopedEdges = edges.filter((e) => idSet.has(e.source) && idSet.has(e.target))
  const mode = selectedIds.length ? 'subgraph' : 'full'
  const downloadOpts: DownloadMediaOptions | undefined = sessionId ? { sessionId } : undefined
  const mediaItems = collectMediaFromNodes(
    scopedNodes.map((n) => ({ id: n.id, type: n.type, data: n.data ?? {} })),
    scopedNodes.map((n) => n.id),
  )

  let mediaOk = 0
  let mediaFail = 0
  const mediaIndex: MediaIndexEntry[] = []
  const stamp = Date.now()

  if (exportMode === 'lightweight') {
    for (const item of mediaItems) {
      mediaIndex.push({
        nodeId: item.nodeId,
        kind: item.kind,
        fileName: item.fileName,
        url: item.url,
      })
    }
    const doc = buildWorkflowDocument({
      nodes: scopedNodes.map((n) => ({
        id: n.id,
        type: String(n.type ?? 'prompt'),
        position: n.position,
        ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
        ...(n.parentNode !== undefined ? { parentNode: n.parentNode } : {}),
        data: n.data ?? {},
      })),
      edges: scopedEdges,
      mode,
      exportMode: 'lightweight',
      sourceSessionId: sessionId,
      mediaIndex,
    })
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    triggerBlobDownload(blob, `lnkpi-workflow-${stamp}.json`)
    toastExportResult(mediaItems.length, 0)
    return { ok: true, mediaOk: mediaItems.length, mediaFail: 0 }
  }

  // full_package
  const zip = new JSZip()
  for (const item of mediaItems) {
    try {
      const blob = await fetchMediaBlob(item.url, item.fileName, downloadOpts)
      if (!blob) {
        mediaFail += 1
        mediaIndex.push({
          nodeId: item.nodeId,
          kind: item.kind,
          fileName: item.fileName,
          url: item.url,
          error: 'download_failed',
        })
        continue
      }
      const path = `media/${item.fileName}`
      zip.file(path, await blob.arrayBuffer())
      mediaOk += 1
      mediaIndex.push({
        nodeId: item.nodeId,
        kind: item.kind,
        fileName: item.fileName,
        path,
        url: item.url,
      })
    } catch {
      mediaFail += 1
      mediaIndex.push({
        nodeId: item.nodeId,
        kind: item.kind,
        fileName: item.fileName,
        url: item.url,
        error: 'download_failed',
      })
    }
  }

  const doc = buildWorkflowDocument({
    nodes: scopedNodes.map((n) => ({
      id: n.id,
      type: String(n.type ?? 'prompt'),
      position: n.position,
      ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
      ...(n.parentNode !== undefined ? { parentNode: n.parentNode } : {}),
      data: n.data ?? {},
    })),
    edges: scopedEdges,
    mode,
    exportMode: 'full_package',
    sourceSessionId: sessionId,
    mediaIndex,
  })
  zip.file('workflow.json', JSON.stringify(doc, null, 2))

  const zipBlob = await zip.generateAsync({ type: 'blob' })
  triggerBlobDownload(zipBlob, `lnkpi-workflow-${stamp}.zip`)
  toastExportResult(mediaOk, mediaFail)
  return { ok: true, mediaOk, mediaFail }
}

export async function importWorkflowPackage(
  file: File,
  ctx: ImportWorkflowPackageContext,
): Promise<ImportWorkflowPackageResult> {
  try {
    const { doc, zip } = await parseWorkflowFile(file)
    const createId = ctx.createId ?? defaultCreateIdFactory(ctx.nodes)
    const { document: remapped, idMap } = remapWorkflowIds(doc, createId)

    const uploadMedia =
      ctx.uploadMedia ??
      (async (mediaFile: File) => {
        const { persistMediaUrl } = await import('./useMediaUpload')
        return persistMediaUrl(mediaFile, URL.createObjectURL(mediaFile))
      })

    if (zip) {
      await uploadZipMedia(zip, remapped, uploadMedia)
    }

    const mergeNodes = toMergeNodes(remapped)
    const mergeEdges: WorkflowExportEdge[] = remapped.graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }))

    await ctx.applyMerge(mergeNodes, mergeEdges)
    ElMessage.success(`已导入工作流：${mergeNodes.length} 个节点`)
    return { addedNodes: mergeNodes.length, idMap }
  } catch (err) {
    const isInvalidFormat =
      err instanceof SyntaxError ||
      (err !== null &&
        typeof err === 'object' &&
        ((err as { name?: string }).name === 'ZodError' ||
          /format|version|Expected|Invalid/i.test(
            err instanceof Error ? err.message : String(err),
          )))
    ElMessage.error(isInvalidFormat ? '工作流格式无效，无法导入' : err instanceof Error ? err.message : '导入失败')
    throw err
  }
}
