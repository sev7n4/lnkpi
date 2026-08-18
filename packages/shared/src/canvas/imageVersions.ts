export type ImageVersionSource = 'generate' | 'upload' | 'edit'

export interface ImageVersionEntry {
  id: string
  url: string
  createdAt: string
  source: ImageVersionSource
  generationRecordId?: string
  parentVersionId?: string
  editPrompt?: string
}

export interface ImageVersionState {
  url: string
  currentVersionId?: string
  imageVersions?: ImageVersionEntry[]
  generationRecordId?: string
}

export function currentImageVersion(state: ImageVersionState): ImageVersionEntry | undefined {
  const versions = state.imageVersions ?? []
  if (state.currentVersionId) {
    const match = versions.find((v) => v.id === state.currentVersionId)
    if (match) return match
  }
  return versions[versions.length - 1]
}

export function seedImageVersions(
  state: ImageVersionState,
  opts?: { id?: string; now?: string; source?: ImageVersionSource },
): ImageVersionState {
  if (!state.url || (state.imageVersions?.length ?? 0) > 0) return state
  const id = opts?.id ?? crypto.randomUUID()
  const createdAt = opts?.now ?? new Date().toISOString()
  const source = opts?.source ?? 'generate'
  const entry: ImageVersionEntry = {
    id,
    url: state.url,
    createdAt,
    source,
  }
  if (state.generationRecordId) entry.generationRecordId = state.generationRecordId
  return {
    ...state,
    currentVersionId: id,
    imageVersions: [entry],
  }
}

export function appendEditVersion(
  state: ImageVersionState,
  input: { id: string; url: string; createdAt: string; generationRecordId?: string; editPrompt: string },
): ImageVersionState {
  const parentVersionId = state.currentVersionId ?? currentImageVersion(state)?.id
  const entry: ImageVersionEntry = {
    id: input.id,
    url: input.url,
    createdAt: input.createdAt,
    source: 'edit',
    editPrompt: input.editPrompt,
  }
  if (parentVersionId) entry.parentVersionId = parentVersionId
  if (input.generationRecordId) entry.generationRecordId = input.generationRecordId
  return {
    ...state,
    url: input.url,
    currentVersionId: input.id,
    generationRecordId: input.generationRecordId,
    imageVersions: [...(state.imageVersions ?? []), entry],
  }
}

export function revertImageVersion(state: ImageVersionState, versionId: string): ImageVersionState {
  const target = (state.imageVersions ?? []).find((v) => v.id === versionId)
  if (!target) return state
  return {
    ...state,
    url: target.url,
    currentVersionId: target.id,
    generationRecordId: target.generationRecordId,
  }
}
