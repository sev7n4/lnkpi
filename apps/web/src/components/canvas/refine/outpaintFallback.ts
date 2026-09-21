/**
 * 扩图模式下允许空 prompt（规格 §3）：上游若拒绝空 prompt，前端兜底一句英文描述，
 * 让生成模型知道「把画布扩展到新尺寸并自然填充扩出区」。
 */
export const OUTPAINT_FALLBACK_PROMPT =
  'Expand the image to the new canvas size and naturally fill the extended region to match the original style.'
