import type { AxiosResponse } from 'axios'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { CanvasEdgeLike } from '@/composables/useUpstreamNodeContext'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'
import { useNodeGeneration } from '@/composables/useNodeGeneration'
import { defaultModelKey } from '@/constants/studioModels'
import { canvasApi } from '@/services/canvas-api'
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

function mockAxiosResponse<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config: {} as AxiosResponse<T>['config'] }
}

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
    edges: ref<CanvasEdgeLike[]>([]),
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
    vi.mocked(studioApi.generateAudio).mockResolvedValue(
      mockAxiosResponse({ data: { ...completedRecord, type: 'audio', url: 'https://example.com/out.mp3' } }),
    )
    vi.mocked(studioApi.generateImage).mockResolvedValue(
      mockAxiosResponse({ data: completedRecord }),
    )
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
        model: 'minimax-speech-2.8-hd',
        voice: 'male-1',
        emotion: 'happy',
        language: 'en',
        speed: 1.5,
        volume: 1,
        pitch: 0,
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

  it('passes shot-linked image child params to canvasApi.generateImage', async () => {
    const shot = createNode('shot', { title: 'Shot', prompt: 'sunset' }, 'shot-1')
    const image = createNode('image', {
      prompt: 'sunset',
      imageModel: 'navo-pro',
      imageAspect: '9:16',
      imageResolution: '2K',
    }, 'image-1')
    const { api, deps } = createDeps([shot, image])
    deps.edges.value = [{ id: 'e1', source: 'shot-1', target: 'image-1' }]
    vi.mocked(canvasApi.generateImage).mockResolvedValue(mockAxiosResponse({ data: {} }))

    await api.generateForNode(image)

    expect(canvasApi.generateImage).toHaveBeenCalledWith('shot-1', 'sunset', {
      model: 'navo-pro',
      aspectRatio: '9:16',
      resolution: '2K',
      count: 1,
      refs: [],
      mentionedKeys: [],
    })
    expect(studioApi.generateImage).not.toHaveBeenCalled()
    expect(deps.startShotPolling).toHaveBeenCalledWith(['shot-1'])
  })

  it('shot-linked image sends media local prompt and refs, not canvasPrompt', async () => {
    const textUpstream = createNode('text', { content: 'upstream style', prompt: 'upstream style' }, 'text-1')
    const shot = createNode('shot', { title: 'Shot', prompt: 'shot prompt' }, 'shot-1')
    const image = createNode('image', {
      prompt: '',
      imageModel: 'navo-pro',
      imageAspect: '9:16',
      imageResolution: '2K',
    }, 'image-1')
    const { api, deps } = createDeps([textUpstream, shot, image])
    deps.edges.value = [
      { id: 'e-shot-image', source: 'shot-1', target: 'image-1' },
      { id: 'e-text-image', source: 'text-1', target: 'image-1' },
    ]
    vi.mocked(canvasApi.generateImage).mockResolvedValue(mockAxiosResponse({ data: {} }))

    await api.generateForNode(image)

    expect(canvasApi.generateImage).toHaveBeenCalledWith(
      'shot-1',
      '',
      expect.objectContaining({
        refs: expect.arrayContaining([
          expect.objectContaining({ refKey: 'T1', mediaType: 'text', text: 'upstream style' }),
        ]),
        mentionedKeys: [],
      }),
    )
    expect(canvasApi.generateImage).not.toHaveBeenCalledWith('shot-1', 'upstream style', expect.anything())
  })

  it('blocks canvas image when blob ref present', async () => {
    const refNode = createNode('image', { url: 'blob:http://localhost/ref-456' }, 'ref-1')
    const shot = createNode('shot', { title: 'Shot', prompt: 'sunset' }, 'shot-1')
    const image = createNode('image', {
      prompt: 'sunset',
      localRefs: [{ id: 'r1', mediaType: 'image', sourceKind: 'upload', label: 'ref', url: 'blob:http://localhost/ref-456' }],
      refOrder: ['r1'],
    }, 'image-1')
    const { api, deps } = createDeps([refNode, shot, image])
    deps.edges.value = [{ id: 'e1', source: 'shot-1', target: 'image-1' }]

    await api.generateForNode(image)

    expect(canvasApi.generateImage).not.toHaveBeenCalled()
    expect(deps.patchNodeData).toHaveBeenCalledWith('image-1', {
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '参考图尚未上传，请先上传后再生成',
    })
  })

  it('generateShot uses shot local prompt with shot refs', async () => {
    const textUpstream = createNode('text', { content: 'cinematic', prompt: 'cinematic' }, 'text-1')
    const shot = createNode('shot', {
      title: 'Shot',
      prompt: 'local shot @T1',
      shotGenerateMode: 'image',
    }, 'shot-1')
    const { api, deps } = createDeps([textUpstream, shot])
    deps.edges.value = [{ id: 'e-text-shot', source: 'text-1', target: 'shot-1' }]
    vi.mocked(canvasApi.editShot).mockResolvedValue(mockAxiosResponse({ data: {} }))
    vi.mocked(canvasApi.generateImage).mockResolvedValue(mockAxiosResponse({ data: {} }))

    await api.generateForNode(shot)

    expect(canvasApi.generateImage).toHaveBeenCalledWith(
      'shot-1',
      'local shot @T1',
      expect.objectContaining({
        refs: expect.arrayContaining([
          expect.objectContaining({ refKey: 'T1', mediaType: 'text', text: 'cinematic' }),
        ]),
        mentionedKeys: ['T1'],
      }),
    )
  })

  it('passes shot-linked video child params to canvasApi.generateVideo', async () => {
    const shot = createNode('shot', { title: 'Shot', prompt: 'motion' }, 'shot-1')
    const video = createNode('video', {
      prompt: 'motion',
      videoModel: 'happyhose-1.1',
      videoSettings: {
        duration: 10,
        aspectRatio: '9:16',
        resolution: '1080p',
        crop: 'center',
      },
    }, 'video-1')
    const { api, deps } = createDeps([shot, video])
    deps.edges.value = [{ id: 'e1', source: 'shot-1', target: 'video-1' }]
    vi.mocked(canvasApi.generateVideo).mockResolvedValue(mockAxiosResponse({ data: {} }))

    await api.generateForNode(video)

    expect(canvasApi.generateVideo).toHaveBeenCalledWith('shot-1', 'motion', {
      model: 'happyhose-1.1',
      duration: 10,
      aspectRatio: '9:16',
      resolution: '1080p',
      crop: 'center',
      refs: [],
      mentionedKeys: [],
    })
    expect(studioApi.generateVideo).not.toHaveBeenCalled()
    expect(deps.startShotPolling).toHaveBeenCalledWith(['shot-1'])
  })

  it('uses catalog defaults for generateShot when media child is missing', async () => {
    const shot = createNode('shot', { title: 'Shot', prompt: 'fallback', shotGenerateMode: 'image' }, 'shot-1')
    const { api } = createDeps([shot])
    vi.mocked(canvasApi.editShot).mockResolvedValue(mockAxiosResponse({ data: {} }))
    vi.mocked(canvasApi.generateImage).mockResolvedValue(mockAxiosResponse({ data: {} }))

    await api.generateForNode(shot)

    expect(canvasApi.generateImage).toHaveBeenCalledWith('shot-1', 'fallback', {
      model: defaultModelKey('image'),
      aspectRatio: '16:9',
      resolution: '1K',
      count: 1,
      refs: [],
      mentionedKeys: [],
    })
  })

  it('keeps independent studio image path on studioApi', async () => {
    const node = createNode('image', {
      prompt: 'standalone cat',
      imageModel: 'seedream-5.0-pro',
      imageAspect: '16:9',
      imageResolution: '2K',
      imageCount: 2,
    })
    const { api } = createDeps([node])

    await api.generateForNode(node)

    expect(studioApi.generateImage).toHaveBeenCalledWith(
      'standalone cat',
      'seedream-5.0-pro',
      '16:9',
      [],
      [],
      '2K',
      2,
    )
    expect(canvasApi.generateImage).not.toHaveBeenCalled()
  })
})
