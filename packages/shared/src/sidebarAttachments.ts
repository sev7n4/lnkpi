import { z } from 'zod'

export const SIDEBAR_ATTACHMENT_MAX = 5

export const SidebarAttachmentSchema = z.object({
  id: z.string().min(1),
  mediaType: z.enum(['text', 'image', 'video', 'audio']),
  sourceKind: z.enum(['upload', 'asset', 'canvasNode']),
  label: z.string().min(1),
  url: z.string().optional(),
  text: z.string().optional(),
  sourceNodeId: z.string().optional(),
})

export type SidebarAttachment = z.infer<typeof SidebarAttachmentSchema>

export function validateSidebarAttachments(items: SidebarAttachment[]): SidebarAttachment[] {
  if (items.length > SIDEBAR_ATTACHMENT_MAX) {
    throw new Error(`最多添加 ${SIDEBAR_ATTACHMENT_MAX} 个参考素材`)
  }
  const parsed = items.map((item) => SidebarAttachmentSchema.parse(item))
  for (const item of parsed) {
    if (!item.url?.trim() && !item.text?.trim()) {
      throw new Error('参考素材缺少 url 或 text')
    }
    if (item.url?.startsWith('blob:')) {
      throw new Error('blob URL 不允许作为参考素材')
    }
  }
  return parsed
}
