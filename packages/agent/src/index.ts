export { CanvasAgent, RuleBasedAgent, OpenAIAgent } from './agent'
export { CANVAS_TOOLS } from './tools/canvas-tools'
export { CanvasToolExecutor, applyCanvasActions } from './tools/executor'
export { createImageProvider, PlaceholderImageProvider, OpenAIImageProvider } from './tools/image-provider'
export { createTextProvider, PlaceholderTextProvider, OpenAITextProvider } from './tools/text-provider'
export { createVideoProvider, PlaceholderVideoProvider, AgnesVideoProvider, resolveVideoParams } from './tools/video-provider'
export { createAudioProvider, PlaceholderAudioProvider, OpenAITTSProvider, FallbackAudioProvider } from './tools/audio-provider'
export type { ImageProvider } from './tools/image-provider'
export type { TextProvider } from './tools/text-provider'
export type { VideoProvider } from './tools/video-provider'
export type { AudioProvider } from './tools/audio-provider'
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
