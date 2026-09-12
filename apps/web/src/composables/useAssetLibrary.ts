import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { assetsApi, type SaveUserAssetPayload } from '@/services/assets-api'
import { isUpstreamMediaUrl } from '@/composables/useCanvasMedia'

/** 与服务端 PersistRemoteDto / SaveUserAssetDto `@MaxLength(128)` 对齐：资产库标题，不是文件名 */
export const ASSET_LIBRARY_LABEL_MAX = 128

/** 资产库版本号：保存/删除成功后自增，资产库面板据此重新拉取 */
export const assetLibraryVersion = ref(0)

export function bumpAssetLibrary() {
  assetLibraryVersion.value += 1
}

function defaultAssetLibraryLabel(kind: SaveUserAssetPayload['kind']): string {
  switch (kind) {
    case 'video':
      return '视频'
    case 'audio':
      return '音频'
    default:
      return '图片'
  }
}

/**
 * 资产库展示标题：优先短 label，其次 prompt，再默认「图片/视频/音频」；超长截断到 128。
 * 完整提示词应留在 generation metadata，不要整段塞进 label。
 */
export function resolveAssetLibraryLabel(opts: {
  kind: SaveUserAssetPayload['kind']
  label?: string | null
  prompt?: string | null
}): string {
  const preferred =
    (typeof opts.label === 'string' && opts.label.trim()) ||
    (typeof opts.prompt === 'string' && opts.prompt.trim()) ||
    defaultAssetLibraryLabel(opts.kind)
  if (preferred.length <= ASSET_LIBRARY_LABEL_MAX) return preferred
  return preferred.slice(0, ASSET_LIBRARY_LABEL_MAX)
}

export type SaveAssetToLibraryInput = SaveUserAssetPayload & {
  /** Dock 提示词；仅在没有短 label 时作标题后备，会截断 */
  prompt?: string | null
}

/** 把节点媒体保存进全局资产库（需登录；同一 URL 幂等） */
export async function saveAssetToLibrary(payload: SaveAssetToLibraryInput) {
  if (!localStorage.getItem('token')) {
    ElMessage.warning('登录后才能保存到资产库')
    return false
  }
  if (payload.url.startsWith('blob:')) {
    ElMessage.warning('该文件尚未上传成功，无法保存到资产库')
    return false
  }
  const { prompt: _prompt, ...rest } = payload
  const label = resolveAssetLibraryLabel({
    kind: payload.kind,
    label: payload.label,
    prompt: payload.prompt,
  })
  const normalized: SaveUserAssetPayload = { ...rest, label }
  try {
    if (isUpstreamMediaUrl(normalized.url)) {
      await assetsApi.persistRemote({
        url: normalized.url,
        kind: normalized.kind,
        label: normalized.label,
        sourceNodeId: normalized.sourceNodeId,
        sessionId: normalized.sessionId,
        replaceNodeUrl: normalized.replaceNodeUrl,
        generationRecordId: normalized.generationRecordId,
      })
    } else {
      await assetsApi.saveMine(normalized)
    }
    bumpAssetLibrary()
    ElMessage.success('已存入资产库')
    return true
  } catch (e: unknown) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status === 503) {
      ElMessage.error('对象存储未配置，无法持久化收藏。请配置 OBJECT_STORAGE_* 或稍后重试')
    } else {
      ElMessage.error('保存失败，请稍后重试')
    }
    return false
  }
}
