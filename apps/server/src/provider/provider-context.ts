import type { ProviderResolverService } from './provider-resolver.service'

export type ProviderSource = 'user' | 'platform'

export type ProviderContext = {
  providerRef: string
  model: string
  apiKey: string
  baseUrl: string
  source: ProviderSource
}

export async function buildTextProviderContext(
  resolver: ProviderResolverService,
  userId: string,
  providerRef: string,
): Promise<ProviderContext> {
  const ref = providerRef.trim()
  if (!ref) throw new Error('providerRef required')
  const resolved = await resolver.resolveForGeneration(userId, ref, 'text')
  const apiKey = resolved.credentials.apiKey?.trim() ?? ''
  const baseUrl = resolved.credentials.baseUrl?.trim() ?? ''
  if (!apiKey || !baseUrl) {
    throw new Error('ProviderContext incomplete: apiKey and baseUrl required')
  }
  return {
    providerRef: ref,
    model: resolved.modelName,
    apiKey,
    baseUrl,
    source: resolved.source,
  }
}
