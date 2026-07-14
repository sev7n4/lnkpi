/** 导演台 sceneComposer 节点编排数据结构（D-2） */

export type SceneComposerShotMediaType = 'image' | 'video' | 'none'

export interface SceneComposerShot {
  id: string
  title: string
  prompt: string
  previewUrl?: string
  mediaType: SceneComposerShotMediaType
  /** 展开后在画布上的 shot 节点 id */
  shotNodeId?: string
  imageNodeId?: string
  videoNodeId?: string
}

export interface SceneComposerScene {
  id: string
  title: string
  description?: string
  previewUrl?: string
  shots: SceneComposerShot[]
}

export interface SceneComposerPayload {
  title?: string
  prompt?: string
  coverUrl?: string
  scenes: SceneComposerScene[]
  expanded?: boolean
  expandedAt?: string
}

export interface SceneComposerBatchItem {
  shotNodeId: string
  title?: string
  prompt: string
  mediaType: Exclude<SceneComposerShotMediaType, 'none'>
}

export interface SceneComposerSaveRequest {
  sessionId: string
  composerNodeId: string
  title?: string
  prompt?: string
  scenes: SceneComposerScene[]
}

export interface SceneComposerBatchGenerateRequest {
  sessionId: string
  composerNodeId: string
  items: SceneComposerBatchItem[]
}

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptySceneComposerShot(
  partial?: Partial<SceneComposerShot>,
): SceneComposerShot {
  return {
    id: partial?.id ?? newId('sc-shot'),
    title: partial?.title ?? '新镜头',
    prompt: partial?.prompt ?? '',
    mediaType: partial?.mediaType ?? 'image',
    previewUrl: partial?.previewUrl,
    shotNodeId: partial?.shotNodeId,
    imageNodeId: partial?.imageNodeId,
    videoNodeId: partial?.videoNodeId,
  }
}

export function createEmptySceneComposerScene(
  partial?: Partial<SceneComposerScene>,
): SceneComposerScene {
  const shots = partial?.shots?.length
    ? partial.shots.map((s) => createEmptySceneComposerShot(s))
    : [createEmptySceneComposerShot()]
  return {
    id: partial?.id ?? newId('sc-scene'),
    title: partial?.title ?? '场景 1',
    description: partial?.description ?? '',
    previewUrl: partial?.previewUrl,
    shots,
  }
}

export function createDefaultSceneComposerPayload(
  partial?: Partial<SceneComposerPayload>,
): SceneComposerPayload {
  const scenes = partial?.scenes?.length
    ? partial.scenes.map((s) => createEmptySceneComposerScene(s))
    : [createEmptySceneComposerScene({ title: '场景 1' })]
  return {
    title: partial?.title ?? '场景编排',
    prompt: partial?.prompt ?? '',
    coverUrl: partial?.coverUrl,
    scenes,
    expanded: partial?.expanded ?? false,
    expandedAt: partial?.expandedAt,
  }
}

export function normalizeSceneComposerPayload(
  raw: Record<string, unknown> | undefined | null,
): SceneComposerPayload {
  if (!raw || typeof raw !== 'object') {
    return createDefaultSceneComposerPayload()
  }

  const scenesRaw = Array.isArray(raw.scenes) ? raw.scenes : []
  const scenes: SceneComposerScene[] = scenesRaw.map((scene, sceneIndex) => {
    const s = scene as Record<string, unknown>
    const shotsRaw = Array.isArray(s.shots) ? s.shots : []
    const shots: SceneComposerShot[] = shotsRaw.map((shot, shotIndex) => {
      const sh = shot as Record<string, unknown>
      const mediaType = sh.mediaType as SceneComposerShotMediaType | undefined
      return createEmptySceneComposerShot({
        id: typeof sh.id === 'string' ? sh.id : undefined,
        title: typeof sh.title === 'string' ? sh.title : `镜头 ${shotIndex + 1}`,
        prompt: typeof sh.prompt === 'string' ? sh.prompt : '',
        previewUrl: typeof sh.previewUrl === 'string' ? sh.previewUrl : undefined,
        mediaType: mediaType === 'video' || mediaType === 'none' ? mediaType : 'image',
        shotNodeId: typeof sh.shotNodeId === 'string' ? sh.shotNodeId : undefined,
        imageNodeId: typeof sh.imageNodeId === 'string' ? sh.imageNodeId : undefined,
        videoNodeId: typeof sh.videoNodeId === 'string' ? sh.videoNodeId : undefined,
      })
    })
    return createEmptySceneComposerScene({
      id: typeof s.id === 'string' ? s.id : undefined,
      title: typeof s.title === 'string' ? s.title : `场景 ${sceneIndex + 1}`,
      description: typeof s.description === 'string' ? s.description : '',
      previewUrl: typeof s.previewUrl === 'string' ? s.previewUrl : undefined,
      shots: shots.length ? shots : undefined,
    })
  })

  return createDefaultSceneComposerPayload({
    title: typeof raw.title === 'string' ? raw.title : undefined,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
    coverUrl: typeof raw.coverUrl === 'string' ? raw.coverUrl : undefined,
    scenes: scenes.length ? scenes : undefined,
    expanded: raw.expanded === true,
    expandedAt: typeof raw.expandedAt === 'string' ? raw.expandedAt : undefined,
  })
}

export function countSceneComposerShots(payload: SceneComposerPayload) {
  let total = 0
  for (const scene of payload.scenes) {
    total += scene.shots.length
  }
  return total
}

export function resolveSceneComposerCoverUrl(payload: SceneComposerPayload) {
  if (payload.coverUrl) return payload.coverUrl
  for (const scene of payload.scenes) {
    if (scene.previewUrl) return scene.previewUrl
    for (const shot of scene.shots) {
      if (shot.previewUrl) return shot.previewUrl
    }
  }
  return undefined
}
