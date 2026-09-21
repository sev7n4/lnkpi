import { ref, watch } from 'vue'

/**
 * 精修工作图的原始尺寸解析（follow-up #4）。
 *
 * 链路断点：CanvasPage 的 refineMediaWidth/Height 只读 `node.data.mediaInfo`，
 * 部分节点（老数据 / 上传未探测）没有这份元数据 → dock 的尺寸 chip 永远回退「原始尺寸」，
 * 违反规格 §6.1（尺寸 = 原图 宽×高 · 比例）。
 *
 * 这里做兜底：元数据可信时直接用；否则用 Image() 探测 naturalWidth/Height。
 * RefineWorkViewport 已有同款探测逻辑（imgW/imgH），本 composable 是它面向 dock 的副本
 * —— 视口的实例不提升，因为视口可能被 v-show 隐藏但 dock 仍需要显示尺寸。
 */
export function useNaturalImageSize(input: {
  url: () => string
  width: () => number | undefined
  height: () => number | undefined
}) {
  const width = ref(0)
  const height = ref(0)

  watch(
    () => [input.url(), input.width(), input.height()] as const,
    ([url, w, h], _prev, onCleanup) => {
      if (Number(w) > 1 && Number(h) > 1) {
        width.value = Number(w)
        height.value = Number(h)
        return
      }
      width.value = 0
      height.value = 0
      if (!url) return
      let cancelled = false
      const img = new Image()
      img.onload = () => {
        if (cancelled) return
        width.value = img.naturalWidth
        height.value = img.naturalHeight
      }
      img.src = url
      onCleanup(() => {
        cancelled = true
      })
    },
    { immediate: true },
  )

  return { width, height }
}
