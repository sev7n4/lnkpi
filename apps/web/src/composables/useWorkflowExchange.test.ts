import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { ElMessage } from 'element-plus'

vi.mock('@/services/api-base', () => ({
  apiUrl: (path: string) => `/api${path}`,
  resolveMediaUrl: (url: string) => url,
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const fetchMediaBlobMock = vi.fn()
const uploadMediaMock = vi.fn()

vi.mock('./useCanvasMedia', async () => {
  const actual = await vi.importActual<typeof import('./useCanvasMedia')>('./useCanvasMedia')
  return {
    ...actual,
    fetchMediaBlob: (...args: unknown[]) => fetchMediaBlobMock(...args),
    downloadMediaPackage: vi.fn(async () => 1),
  }
})

import { buildWorkflowDocument } from '@lnkpi/shared'
import { exportWorkflowPackage, importWorkflowPackage } from './useWorkflowExchange'
import { downloadMediaPackage } from './useCanvasMedia'
import {
  IMPORT_NODE_ESTIMATE,
  IMPORT_PLACE_MARGIN,
  rectsOverlap,
  unionNodeBBox,
} from './workflowImportPlacement'

async function zipWithWorkflow(
  doc: ReturnType<typeof buildWorkflowDocument>,
  mediaFiles: Array<{ path: string; content: string }> = [],
): Promise<File> {
  const zip = new JSZip()
  zip.file('workflow.json', JSON.stringify(doc))
  for (const m of mediaFiles) {
    zip.file(m.path, m.content)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], 'workflow.zip', { type: 'application/zip' })
}

describe('exportWorkflowPackage', () => {
  beforeEach(() => {
    fetchMediaBlobMock.mockReset()
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessage.warning).mockClear()
    vi.mocked(downloadMediaPackage).mockClear()
    ;(URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi.fn(
      () => 'blob:mock-zip',
    )
    ;(URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('full_package builds zip with workflow.json and media/', async () => {
    fetchMediaBlobMock.mockResolvedValue(new Blob(['png-bytes'], { type: 'image/png' }))

    const result = await exportWorkflowPackage({
      nodes: [
        {
          id: 'image-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { url: 'https://cdn.example/a.png', title: 'hero' },
        },
        {
          id: 'prompt-1',
          type: 'prompt',
          position: { x: 100, y: 0 },
          data: { prompt: 'hello' },
        },
      ],
      edges: [{ id: 'e1', source: 'prompt-1', target: 'image-1' }],
      selectedIds: [],
      sessionId: 'sess-1',
      exportMode: 'full_package',
    })

    expect(result.ok).toBe(true)
    expect(result.mediaOk).toBe(1)
    expect(result.mediaFail).toBe(0)
    expect(fetchMediaBlobMock).toHaveBeenCalledOnce()

    const createObjectURL = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>
    expect(createObjectURL).toHaveBeenCalled()
    const zipBlob = createObjectURL.mock.calls[0][0] as Blob
    expect(zipBlob.type).toMatch(/zip|octet-stream/)

    const zip = await JSZip.loadAsync(zipBlob)
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^workflow\.json$/),
        expect.stringMatching(/^media\//),
      ]),
    )

    const workflowJson = await zip.file('workflow.json')!.async('string')
    const doc = JSON.parse(workflowJson) as {
      format: string
      exportMode: string
      mode: string
      mediaIndex: Array<{ path?: string; nodeId: string }>
    }
    expect(doc.format).toBe('lnkpi.workflow')
    expect(doc.exportMode).toBe('full_package')
    expect(doc.mode).toBe('full')
    expect(doc.mediaIndex[0]?.path).toMatch(/^media\//)
    expect(doc.mediaIndex[0]?.nodeId).toBe('image-1')

    const mediaFiles = Object.keys(zip.files).filter((k) => k.startsWith('media/') && !zip.files[k].dir)
    expect(mediaFiles.length).toBe(1)
    const mediaText = await zip.file(mediaFiles[0])!.async('string')
    expect(mediaText).toBe('png-bytes')
  })

  it('lightweight downloads workflow json only', async () => {
    const result = await exportWorkflowPackage({
      nodes: [
        {
          id: 'image-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { url: 'https://cdn.example/a.png', title: 'hero' },
        },
      ],
      edges: [],
      selectedIds: ['image-1'],
      exportMode: 'lightweight',
    })

    expect(result.ok).toBe(true)
    expect(fetchMediaBlobMock).not.toHaveBeenCalled()
    const createObjectURL = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toContain('json')
    const text = await blob.text()
    const doc = JSON.parse(text) as { exportMode: string; mode: string }
    expect(doc.exportMode).toBe('lightweight')
    expect(doc.mode).toBe('subgraph')
  })

  it('media_list_only delegates to downloadMediaPackage', async () => {
    const result = await exportWorkflowPackage({
      nodes: [
        {
          id: 'image-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { url: 'https://cdn.example/a.png' },
        },
      ],
      edges: [],
      selectedIds: ['image-1'],
      sessionId: 'sess-1',
      exportMode: 'media_list_only',
    })

    expect(result.ok).toBe(true)
    expect(downloadMediaPackage).toHaveBeenCalledOnce()
    expect(fetchMediaBlobMock).not.toHaveBeenCalled()
  })

  it('media_list_only expands selected group to child ids', async () => {
    await exportWorkflowPackage({
      nodes: [
        {
          id: 'group-1',
          type: 'group',
          position: { x: 0, y: 0 },
          data: { title: 'pack' },
        },
        {
          id: 'image-1',
          type: 'image',
          position: { x: 10, y: 10 },
          parentNode: 'group-1',
          data: { url: 'https://cdn.example/a.png' },
        },
        {
          id: 'prompt-1',
          type: 'prompt',
          position: { x: 20, y: 10 },
          parentNode: 'group-1',
          data: { prompt: 'hi' },
        },
        {
          id: 'image-outside',
          type: 'image',
          position: { x: 200, y: 0 },
          data: { url: 'https://cdn.example/b.png' },
        },
      ],
      edges: [],
      selectedIds: ['group-1'],
      sessionId: 'sess-1',
      exportMode: 'media_list_only',
    })

    expect(downloadMediaPackage).toHaveBeenCalledOnce()
    const passedIds = vi.mocked(downloadMediaPackage).mock.calls[0][1] as string[]
    expect(passedIds).toEqual(expect.arrayContaining(['group-1', 'image-1', 'prompt-1']))
    expect(passedIds).not.toContain('image-outside')
  })
})

describe('importWorkflowPackage', () => {
  beforeEach(() => {
    uploadMediaMock.mockReset()
    uploadMediaMock.mockResolvedValue('https://cdn.example/uploaded.png')
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessage.warning).mockClear()
    vi.mocked(ElMessage.error).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges remapped zip nodes/edges without colliding with seed canvas ids', async () => {
    const doc = buildWorkflowDocument({
      nodes: [
        {
          id: 'prompt-1',
          type: 'prompt',
          position: { x: 10, y: 20 },
          data: { prompt: 'hello' },
        },
        {
          id: 'image-1',
          type: 'image',
          position: { x: 100, y: 20 },
          data: { url: 'https://cdn.example/old.png', title: 'hero' },
        },
      ],
      edges: [{ id: 'e1', source: 'prompt-1', target: 'image-1' }],
      mode: 'full',
      exportMode: 'full_package',
      mediaIndex: [
        {
          nodeId: 'image-1',
          kind: 'image',
          fileName: 'hero.png',
          path: 'media/hero.png',
        },
      ],
    })
    const file = await zipWithWorkflow(doc, [{ path: 'media/hero.png', content: 'png-bytes' }])

    const seedNodes = [
      { id: 'prompt-1', type: 'prompt', position: { x: 0, y: 0 }, data: {} },
      { id: 'image-1', type: 'image', position: { x: 50, y: 0 }, data: {} },
    ]
    const applyMerge = vi.fn()
    let seq = 0
    const createId = (type: string) => `${type}-imported-${++seq}`

    const result = await importWorkflowPackage(file, {
      nodes: seedNodes,
      edges: [],
      sessionId: 'sess-1',
      applyMerge,
      createId,
      uploadMedia: uploadMediaMock,
    })

    expect(applyMerge).toHaveBeenCalledOnce()
    const [mergedNodes, mergedEdges] = applyMerge.mock.calls[0] as [
      Array<{ id: string; position: { x: number; y: number }; data?: Record<string, unknown> }>,
      Array<{ id: string; source: string; target: string }>,
    ]

    expect(result.addedNodes).toBe(2)
    expect(Object.keys(result.idMap)).toEqual(expect.arrayContaining(['prompt-1', 'image-1']))
    expect(mergedNodes.map((n) => n.id)).toEqual(['prompt-imported-1', 'image-imported-2'])
    expect(mergedNodes.every((n) => !seedNodes.some((s) => s.id === n.id))).toBe(true)
    // Uniform translation: relative delta between roots preserved from file (90px x)
    expect(mergedNodes[1].position.x - mergedNodes[0].position.x).toBe(90)
    expect(mergedNodes[1].position.y - mergedNodes[0].position.y).toBe(0)
    expect(mergedEdges).toHaveLength(1)
    expect(mergedEdges[0].source).toBe('prompt-imported-1')
    expect(mergedEdges[0].target).toBe('image-imported-2')
    expect(uploadMediaMock).toHaveBeenCalledOnce()
    expect(mergedNodes[1].data?.url).toBe('https://cdn.example/uploaded.png')
  })

  it('places import away from overlapping canvas seed with margin', async () => {
    const doc = buildWorkflowDocument({
      nodes: [
        {
          id: 'prompt-1',
          type: 'prompt',
          position: { x: 0, y: 0 },
          data: { prompt: 'hello' },
        },
      ],
      edges: [],
      mode: 'full',
      exportMode: 'lightweight',
      mediaIndex: [],
    })
    const file = new File([JSON.stringify(doc)], 'workflow.json', { type: 'application/json' })
    const seedNodes = [{ id: 'seed-1', type: 'prompt', position: { x: 0, y: 0 }, data: {} }]
    const applyMerge = vi.fn()
    let seq = 0

    await importWorkflowPackage(file, {
      nodes: seedNodes,
      edges: [],
      applyMerge,
      createId: (type) => `${type}-place-${++seq}`,
      uploadMedia: uploadMediaMock,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      getContainerSize: () => ({ width: 1000, height: 800 }),
    })

    expect(applyMerge).toHaveBeenCalledOnce()
    const [mergedNodes] = applyMerge.mock.calls[0] as [
      Array<{ id: string; position: { x: number; y: number } }>,
    ]
    const seedBBox = unionNodeBBox(seedNodes)!
    const importBBox = unionNodeBBox(mergedNodes)!
    expect(rectsOverlap(seedBBox, importBBox, IMPORT_PLACE_MARGIN)).toBe(false)
    // Not the old fixed +80 path
    expect(mergedNodes[0].position).not.toEqual({ x: 80, y: 80 })
  })

  it('calls fitImportedNodes with remapped ids after merge', async () => {
    const doc = buildWorkflowDocument({
      nodes: [
        {
          id: 'prompt-1',
          type: 'prompt',
          position: { x: 0, y: 0 },
          data: { prompt: 'hello' },
        },
        {
          id: 'image-1',
          type: 'image',
          position: { x: 100, y: 0 },
          data: { url: 'https://cdn.example/a.png' },
        },
      ],
      edges: [],
      mode: 'full',
      exportMode: 'lightweight',
      mediaIndex: [],
    })
    const file = new File([JSON.stringify(doc)], 'workflow.json', { type: 'application/json' })
    const applyMerge = vi.fn()
    const fitImportedNodes = vi.fn()
    let seq = 0

    await importWorkflowPackage(file, {
      nodes: [],
      edges: [],
      applyMerge,
      createId: (type) => `${type}-fit-${++seq}`,
      uploadMedia: uploadMediaMock,
      fitImportedNodes,
    })

    expect(applyMerge).toHaveBeenCalledOnce()
    expect(fitImportedNodes).toHaveBeenCalledOnce()
    expect(applyMerge.mock.invocationCallOrder[0]).toBeLessThan(
      fitImportedNodes.mock.invocationCallOrder[0],
    )
    expect(fitImportedNodes).toHaveBeenCalledWith(['prompt-fit-1', 'image-fit-2'])
  })

  it('rejects invalid format without calling applyMerge', async () => {
    const file = new File([JSON.stringify({ format: 'nope' })], 'bad.json', {
      type: 'application/json',
    })
    const applyMerge = vi.fn()

    await expect(
      importWorkflowPackage(file, {
        nodes: [],
        edges: [],
        applyMerge,
      }),
    ).rejects.toThrow()

    expect(applyMerge).not.toHaveBeenCalled()
    expect(ElMessage.error).toHaveBeenCalled()
  })

  it('offsets only root nodes; group children keep relative position and parent constraints', async () => {
    const doc = buildWorkflowDocument({
      nodes: [
        {
          id: 'group-1',
          type: 'group',
          position: { x: 40, y: 50 },
          data: { title: 'pack' },
        },
        {
          id: 'prompt-1',
          type: 'prompt',
          position: { x: 12, y: 18 },
          parentNode: 'group-1',
          data: { prompt: 'inside' },
        },
      ],
      edges: [],
      mode: 'subgraph',
      exportMode: 'lightweight',
      mediaIndex: [],
    })
    const file = new File([JSON.stringify(doc)], 'workflow.json', { type: 'application/json' })
    const seedNodes = [{ id: 'seed-1', type: 'prompt', position: { x: 0, y: 0 }, data: {} }]
    const applyMerge = vi.fn()
    let seq = 0

    await importWorkflowPackage(file, {
      nodes: seedNodes,
      edges: [],
      applyMerge,
      createId: (type) => `${type}-grp-${++seq}`,
      uploadMedia: uploadMediaMock,
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      getContainerSize: () => ({ width: 1000, height: 800 }),
    })

    expect(applyMerge).toHaveBeenCalledOnce()
    const [mergedNodes] = applyMerge.mock.calls[0] as [
      Array<{
        id: string
        position: { x: number; y: number }
        parentNode?: string
        extent?: string
        expandParent?: boolean
      }>,
    ]

    const parent = mergedNodes.find((n) => n.id === 'group-grp-1')
    const child = mergedNodes.find((n) => n.id === 'prompt-grp-2')
    expect(parent).toBeDefined()
    expect(child).toBeDefined()
    // Same uniform translation applied to root only
    const dx = parent!.position.x - 40
    const dy = parent!.position.y - 50
    expect(dx !== 0 || dy !== 0).toBe(true)
    expect(child!.position).toEqual({ x: 12, y: 18 })
    expect(child!.parentNode).toBe('group-grp-1')
    expect(child!.extent).toBe('parent')
    expect(child!.expandParent).toBe(true)
    expect(parent!.parentNode).toBeUndefined()
    expect(parent!.extent).toBeUndefined()
    expect(parent!.expandParent).toBeUndefined()
    // Placed root clears seed with margin
    const seedBBox = unionNodeBBox(seedNodes)!
    const placedRoot = {
      x: parent!.position.x,
      y: parent!.position.y,
      width: IMPORT_NODE_ESTIMATE.width,
      height: IMPORT_NODE_ESTIMATE.height,
    }
    expect(rectsOverlap(seedBBox, placedRoot, IMPORT_PLACE_MARGIN)).toBe(false)
  })

  it('lightweight json keeps existing urls without re-upload', async () => {
    const doc = buildWorkflowDocument({
      nodes: [
        {
          id: 'image-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { url: 'https://cdn.example/keep.png' },
        },
      ],
      edges: [],
      mode: 'subgraph',
      exportMode: 'lightweight',
      mediaIndex: [
        {
          nodeId: 'image-1',
          kind: 'image',
          fileName: 'keep.png',
          url: 'https://cdn.example/keep.png',
        },
      ],
    })
    const file = new File([JSON.stringify(doc)], 'workflow.json', { type: 'application/json' })
    const applyMerge = vi.fn()
    let seq = 0

    await importWorkflowPackage(file, {
      nodes: [],
      edges: [],
      applyMerge,
      createId: (type) => `${type}-lite-${++seq}`,
      uploadMedia: uploadMediaMock,
    })

    expect(uploadMediaMock).not.toHaveBeenCalled()
    const [mergedNodes] = applyMerge.mock.calls[0] as [
      Array<{ data?: Record<string, unknown> }>,
    ]
    expect(mergedNodes[0].data?.url).toBe('https://cdn.example/keep.png')
  })

  it('warns when zip media path is missing but still merges nodes', async () => {
    const doc = buildWorkflowDocument({
      nodes: [
        {
          id: 'image-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { url: 'https://cdn.example/old.png', title: 'hero' },
        },
        {
          id: 'prompt-1',
          type: 'prompt',
          position: { x: 80, y: 0 },
          data: { prompt: 'keep me' },
        },
      ],
      edges: [],
      mode: 'full',
      exportMode: 'full_package',
      mediaIndex: [
        {
          nodeId: 'image-1',
          kind: 'image',
          fileName: 'hero.png',
          path: 'media/hero.png',
        },
      ],
    })
    // Zip has workflow.json but intentionally omits media/hero.png
    const file = await zipWithWorkflow(doc, [])

    const applyMerge = vi.fn()
    let seq = 0

    const result = await importWorkflowPackage(file, {
      nodes: [],
      edges: [],
      applyMerge,
      createId: (type) => `${type}-miss-${++seq}`,
      uploadMedia: uploadMediaMock,
    })

    expect(applyMerge).toHaveBeenCalledOnce()
    expect(result.addedNodes).toBe(2)
    expect(result.mediaOk).toBe(0)
    expect(result.mediaFail).toBe(1)
    expect(uploadMediaMock).not.toHaveBeenCalled()
    expect(ElMessage.warning).toHaveBeenCalledWith(
      expect.stringMatching(/媒体成功 0 \/ 失败 1/),
    )
    expect(ElMessage.success).not.toHaveBeenCalled()
  })
})
