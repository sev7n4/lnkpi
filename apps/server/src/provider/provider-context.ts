import type { ProviderResolverService } from './provider-resolver.service'

export type ProviderSource = 'user' | 'platform'

export type ProviderContext = {
  providerRef: string
  model: string
  apiKey: string
  baseUrl: string
  source: ProviderSource
}

/** Map a resolved generation provider into ProviderContext (shared Agent + canvas contract). */
export function providerContextFromResolved(
  providerRef: string,
  resolved: {
    modelName: string
    credentials: { apiKey?: string; baseUrl?: string }
    source: ProviderSource
  },
): ProviderContext {
  const ref = providerRef.trim()
  if (!ref) throw new Error('providerRef required')
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

export async function buildTextProviderContext(
  resolver: ProviderResolverService,
  userId: string,
  providerRef: string,
): Promise<ProviderContext> {
  const ref = providerRef.trim()
  if (!ref) throw new Error('providerRef required')
  const resolved = await resolver.resolveForGeneration(userId, ref, 'text')
  return providerContextFromResolved(ref, resolved)
}
