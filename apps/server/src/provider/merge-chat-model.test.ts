import { afterEach, describe, expect, it } from 'vitest'
import { resolveModelKey } from '@lnkpi/shared'
import { mergeChatModel } from './merge-chat-model'

const DEFAULT_TEXT_MODEL = resolveModelKey('text', undefined).entry.gatewayModelId

describe('mergeChatModel', () => {
  afterEach(() => {
    delete process.env.OPENAI_CHAT_MODEL
  })

  it('keeps resolved model for text downstream', () => {
    expect(mergeChatModel('text', 'deepseek-v4')).toBe('deepseek-v4')
  })

  it('never passes video/image/audio models to chat merge', () => {
    expect(mergeChatModel('video', 'seedance-2.0-min')).toBe(DEFAULT_TEXT_MODEL)
    expect(mergeChatModel('image', 'seedream-5.0-pro')).toBe(DEFAULT_TEXT_MODEL)
    expect(mergeChatModel('audio', 'speech-2.8-hd')).toBe(DEFAULT_TEXT_MODEL)
  })

  it('prefers OPENAI_CHAT_MODEL env for non-text downstream', () => {
    process.env.OPENAI_CHAT_MODEL = 'my-chat-model'
    expect(mergeChatModel('video', 'seedance-2.0-min')).toBe('my-chat-model')
  })

  it('falls back to default text model when text downstream has no model', () => {
    expect(mergeChatModel('text', undefined)).toBe(DEFAULT_TEXT_MODEL)
  })
})
