/** 音频 Dock 音色列表（与 AudioStudioPage 对齐，Sprint B） */

export interface VoiceOption {
  id: string
  label: string
}

export const AUDIO_VOICE_OPTIONS: VoiceOption[] = [
  { id: 'female-1', label: '女声 · 温柔' },
  { id: 'male-1', label: '男声 · 沉稳' },
  { id: 'narrator', label: '旁白 · 磁性' },
]

export type AudioEmotion = 'neutral' | 'happy' | 'sad' | 'serious'

export const AUDIO_EMOTION_OPTIONS: Array<{ value: AudioEmotion; label: string }> = [
  { value: 'neutral', label: '中性' },
  { value: 'happy', label: '欢快' },
  { value: 'sad', label: '低沉' },
  { value: 'serious', label: '严肃' },
]

export type AudioLanguage = 'zh' | 'en' | 'ja'

export const AUDIO_LANGUAGE_OPTIONS: Array<{ value: AudioLanguage; label: string }> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
]

export const DEFAULT_AUDIO_VOICE = 'female-1'
export const DEFAULT_AUDIO_EMOTION: AudioEmotion = 'neutral'
export const DEFAULT_AUDIO_LANGUAGE: AudioLanguage = 'zh'
export const DEFAULT_AUDIO_SPEED = 1

export type ShotGenerateMode = 'auto' | 'image' | 'video'

export const SHOT_GENERATE_MODE_OPTIONS: Array<{ value: ShotGenerateMode; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'image', label: '生成图像' },
  { value: 'video', label: '生成视频' },
]
