import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import { useNodeGeneration } from '@/composables/useNodeGeneration'
import { studioApi } from '@/services/studio-api'

vi.mock('@/services/studio-api', () => ({
  studioApi: {
    generateImage: vi.fn(),
    generateVideo: vi.fn(),
    generateAudio: vi.fn(),
    generateText: vi.fn(),
    generatePrompt: vi.fn(),
  },
}))

vi.mock('@/services/canvas-api', () => ({
  canvasApi: {
    generateImage: vi.fn(),
    generateVideo: vi.fn(),
    editShot: vi.fn(),
    createShot: vi.fn(),
    saveSceneComposer: vi.fn(),
    batchGenerateSceneComposer: vi.fn(),
    exportVideoComposition: vi.fn(),
  },
}))

const completedRecord = {
  id: 'rec-1',
  type: 'image',
  prompt: 'test',
  status: NODE_GENERATION_STATUS.completed,
  url: 'https://example.com/out.png',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function createNode(
  type: string,
  data: Record<string, unknown>,
  id = `${type}-1`,
): EditableFlowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  }
}

function createDeps(nodes: EditableFlowNode[]) {
  const patchNodeData = vi.fn()
  const saveCanvas = vi.fn(async () => {})
  const requireLogin = vi.fn(() => true)
  const startShotPolling = vi.fn()
  const startGenerationPolling = vi.fn()
  const resolveProviderModels = vi.fn(() => ({
    image: 'default-image-model',
    video: 'default-video-model',
    text: 'default-text-model',
  }))

  const deps = {
    nodes: ref(nodes),
    edges: ref([]),
    sessionId: ref('session-1'),
    patchNodeData,
    addNode: vi.fn(() => 'new-node'),
    addEdge: vi.fn(),
    saveCanvas,
    requireLogin,
    startShotPolling,
    startGenerationPolling,
    resolveProviderModels,
  }

  const api = useNodeGeneration(deps)
  return { api, deps }
}

describe('useNodeGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(studioApi.generateAudio).mockResolvedValue({
      data: { data: { ...completedRecord, type: 'audio', url: 'https://example.com/out.mp3' } },
    })
    vi.mocked(studioApi.generateImage).mockResolvedValue({
      data: { data: completedRecord },
    })
  })

  it('passes audio options to studioApi.generateAudio', async () => {
    const node = createNode('audio', {
      prompt: 'hello world',
      audioVoice: 'male-1',
      audioEmotion: 'happy',
      audioLanguage: 'en',
      audioSpeed: 1.5,
    })
    const { api } = createDeps([node])

    await api.generateForNode(node)

    expect(studioApi.generateAudio).toHaveBeenCalledWith(
      'hello world',
      {
        voice: 'male-1',
        emotion: 'happy',
        language: 'en',
        speed: 1.5,
      },
      [],
      [],
    )
  })

  it('passes model, resolution, and count to studioApi.generateImage', async () => {
    const node = createNode('image', {
      prompt: 'a cat',
      imageModel: 'seedream-5.0-pro',
      imageAspect: '16:9',
      imageResolution: '2K',
      imageCount: 3,
    })
    const { api } = createDeps([node])

    await api.generateForNode(node)

    expect(studioApi.generateImage).toHaveBeenCalledWith(
      'a cat',
      'seedream-5.0-pro',
      '16:9',
      [],
      [],
      '2K',
      3,
    )
  })

  it('blocks image generation when referenceImageUrl is a blob url', async () => {
    const node = createNode('image', {
      prompt: 'a cat',
      referenceImageUrl: 'blob:http://localhost/abc-123',
    })
    const { api, deps } = createDeps([node])

    await api.generateForNode(node)

    expect(studioApi.generateImage).not.toHaveBeenCalled()
    expect(deps.patchNodeData).toHaveBeenCalledWith('image-1', {
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '参考图尚未上传，请先上传后再生成',
    })
  })

  it('blocks image generation when a ref url is a blob url', async () => {
    const refNode = createNode('image', { url: 'blob:http://localhost/ref-456' }, 'ref-1')
    const node = createNode('image', {
      prompt: 'a cat',
      localRefs: [{ refKey: 'r1', sourceNodeId: 'ref-1', mediaType: 'image' }],
      refOrder: ['r1'],
    })
    const { api, deps } = createDeps([node, refNode])
    deps.edges.value = [{ id: 'e1', source: 'ref-1', target: 'image-1' }]

    await api.generateForNode(node)

    expect(studioApi.generateImage).not.toHaveBeenCalled()
    expect(deps.patchNodeData).toHaveBeenCalledWith('image-1', {
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '参考图尚未上传，请先上传后再生成',
    })
  })
})
