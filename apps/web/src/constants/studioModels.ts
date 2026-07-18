import {
  listModels,
  defaultModelKey,
  resolveModelKey,
  getModelEntry,
  type StudioModality,
  type StudioModelEntry,
} from '@lnkpi/shared'

export {
  listModels,
  defaultModelKey,
  resolveModelKey,
  getModelEntry,
  type StudioModality,
  type StudioModelEntry,
}

export function modelsAsSelectorOptions(modality: StudioModality) {
  return listModels(modality).map((m) => ({
    id: m.modelKey,
    name: m.displayName,
    provider: 'catalog',
  }))
}
