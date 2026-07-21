import { resolveModelKey } from '@lnkpi/shared'

/**
 * Chat model used by the refs-merge (chat/completions) call.
 *
 * Non-text generations resolve their own modality model (e.g. a video model),
 * which must never be sent to chat/completions — the gateway rejects it
 * (403 Forbidden) and the whole generation fails. Always merge with a
 * text-capable model instead.
 */
export function mergeChatModel(
  downstreamType: 'text' | 'image' | 'video' | 'audio',
  resolvedModel?: string,
): string | undefined {
  if (downstreamType === 'text' && resolvedModel) return resolvedModel
  return (
    process.env.OPENAI_CHAT_MODEL ||
    resolveModelKey('text', undefined).entry.gatewayModelId
  )
}
