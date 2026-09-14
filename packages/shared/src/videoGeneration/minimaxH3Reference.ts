export const MINIMAX_H3_REF_LIMITS = {
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
  maxFiles: 12,
  maxPromptChars: 7000,
} as const

export const MINIMAX_H3_REF_IMAGE_FREE = 5
export const MINIMAX_H3_REF_IMAGE_EXTRA_POINTS = 5
export const MINIMAX_H3_REF_VIDEO_POINTS = 15

export function assertMiniMaxH3ReferenceLimits(input: {
  imageCount: number
  videoCount: number
  audioCount: number
  promptLength: number
}): void {
  const { maxImages, maxVideos, maxAudios, maxFiles, maxPromptChars } = MINIMAX_H3_REF_LIMITS

  if (input.imageCount > maxImages) {
    throw new Error(`图最多 ${maxImages} 张`)
  }
  if (input.videoCount > maxVideos) {
    throw new Error(`视频最多 ${maxVideos} 段`)
  }
  if (input.audioCount > maxAudios) {
    throw new Error(`音频最多 ${maxAudios} 段`)
  }

  const totalFiles = input.imageCount + input.videoCount + input.audioCount
  if (totalFiles > maxFiles) {
    throw new Error(`参考文件合计最多 ${maxFiles} 个`)
  }
  if (totalFiles === 0) {
    throw new Error('参考生成至少需要 1 个参考文件')
  }

  if (input.promptLength > maxPromptChars) {
    throw new Error(`提示词最多 ${maxPromptChars} 字`)
  }
}
