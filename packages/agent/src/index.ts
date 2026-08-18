export { applyCanvasActions } from './tools/executor'
export { createImageProvider, PlaceholderImageProvider, OpenAIImageProvider } from './tools/image-provider'
export { createImageEditProvider, ApimartImageEditProvider } from './tools/image-edit-provider'
export {
  createTextProvider,
  PlaceholderTextProvider,
  OpenAITextProvider,
  isDeepSeekV4Model,
  buildDeepSeekThinkingFields,
} from './tools/text-provider'

export { createVideoProvider, PlaceholderVideoProvider, AgnesVideoProvider, resolveVideoParams } from './tools/video-provider'
export { createAudioProvider, PlaceholderAudioProvider, OpenAITTSProvider, FallbackAudioProvider } from './tools/audio-provider'
export type { ImageProvider, ProviderCredentialOpts, ImageGenerateOptions } from './tools/image-provider'
export type { ImageEditProvider, ImageEditInput } from './tools/image-edit-provider'
export type { TextProvider, TextGenerateOptions, TextThinkingEffort } from './tools/text-provider'
export type { VideoProvider } from './tools/video-provider'
export type { AudioProvider, AudioGenerateOptions } from './tools/audio-provider'
export type { AgentStreamEvent, AgentMessage, AgentToolCall, AgentContext, AgentToolDefinition } from './types'
export type { PromptModeId, PromptModeDefinition } from './prompt-modes'
export {
  PROMPT_MODES,
  PROMPT_MODE_IDS,
  getPromptMode,
  tryRuleShortcut,
  heuristicMode,
  classifyPromptMode,
  generatePromptContent,
  generatePromptFromUserInput,
} from './prompt-modes'
export { mergeRefsToPrompt } from './refs/merge-refs'
export type { MergeTextSource } from './refs/merge-refs'
export { generateTextWithImages, ECOMMERCE_VISION_SYSTEM, DEFAULT_VISION_USER_PROMPT } from './refs/vision-text'
export type { VisionTextOptions } from './refs/vision-text'
export { extractJsonObject } from './refs/json-extract'
export { generateVisionQaJson, parseVisionQaJson } from './refs/vision-qa-json'
export type { VisionQaJsonOptions, VisionQaJsonResult, ParsedVisionQaJson } from './refs/vision-qa-json'
export {
  appendImageRefsForTextOnlyPrompt,
  generateTextForRefs,
  supportsVisionTextModel,
} from './refs/text-generation'
export type { TextGenerationWithRefsOptions } from './refs/text-generation'
export {
  buildAudioRequest,
  buildImageProviderOptions,
  buildImageProviderGenerateOptions,
  buildEffectiveImagePrompt,
  buildImageRefConsistencyBlock,
  imageRefDescriptorsFromRefs,
  providerReferenceImages,
  stripRefImagePromptTags,
  ensureSeedanceRefTags,
  buildVideoRefConsistencyBlock,
  buildEffectiveVideoPrompt,
  buildVideoProviderOptions,
  buildVideoProviderGenerateOptions,
  Seedance1xUnsupportedError,
} from './studio/generation-adapter'
export {
  buildImageEditRequest,
  buildEditPrompt,
  IMAGE_EDIT_PROMPT_PREFIX,
} from './studio/edit-adapter'
export {
  buildVideoReferenceBundle,
  inferVideoScenario,
} from './studio/video-refs'
export type {
  VideoReferenceItem,
  VideoReferenceBundle,
  VideoScenario,
  VideoMode,
} from './studio/video-refs'
export type {
  AdapterMeta,
  BuiltAudioRequest,
  ImageRefDescriptor,
  ImageProviderGenerateOptions,
  BuiltVideoProviderOptions,
  VideoProviderGenerateOptions,
} from './studio/generation-adapter'
