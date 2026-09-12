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
  },
}))

const fetchMediaBlobMock = vi.fn()

vi.mock('./useCanvasMedia', async () => {
  const actual = await vi.importActual<typeof import('./useCanvasMedia')>('./useCanvasMedia')
  return {
    ...actual,
    fetchMediaBlob: (...args: unknown[]) => fetchMediaBlobMock(...args),
    downloadMediaPackage: vi.fn(async () => 1),
  }
})

import { exportWorkflowPackage } from './useWorkflowExchange'
import { downloadMediaPackage } from './useCanvasMedia'

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
})
