import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { assetsApi, type SaveUserAssetPayload } from '@/services/assets-api'

/** 资产库版本号：保存/删除成功后自增，资产库面板据此重新拉取 */
export const assetLibraryVersion = ref(0)

export function bumpAssetLibrary() {
  assetLibraryVersion.value += 1
}

/** 把节点媒体保存进全局资产库（需登录；同一 URL 幂等） */
export async function saveAssetToLibrary(payload: SaveUserAssetPayload) {
  if (!localStorage.getItem('token')) {
    ElMessage.warning('登录后才能保存到资产库')
    return false
  }
  if (payload.url.startsWith('blob:')) {
    ElMessage.warning('该文件尚未上传成功，无法保存到资产库')
    return false
  }
  try {
    await assetsApi.saveMine(payload)
    bumpAssetLibrary()
    ElMessage.success('已存入资产库')
    return true
  } catch {
    ElMessage.error('保存失败，请稍后重试')
    return false
  }
}
