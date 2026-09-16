import { expect, it } from 'vitest'
import { resolveCompositionVideoPrompt } from './compositionVideo'

function node(
  id: string,
  type: string,
  data: Record<string, unknown> = {},
): { id: string; type: string; data: Record<string, unknown> } {
  return { id, type, data }
}

function runGroup(ids: string[]) {
  return {
    nodeIds: ids,
    dumpHash: 'h1',
    createdAt: '2026-09-16T00:00:00.000Z',
  }
}

it('reads live text-p prompt instead of video node snapshot', () => {
  const result = resolveCompositionVideoPrompt(
    {
      nodes: [
        node('image-i0', 'image', { prompt: 'I0' }),
        node('image-look-0', 'image', { prompt: 'LOOK' }),
        node('text-p', 'text', { prompt: 'NEW SCRIPT' }),
        node('video-v', 'video', { prompt: 'OLD', mentionedKeys: ['image-i0', 'image-look-0'] }),
      ],
      compositionRunGroup: runGroup(['image-i0', 'image-look-0', 'text-p', 'video-v']),
    },
    'video-v',
  )
  expect(result).toEqual({ prompt: 'NEW SCRIPT' })
})

it('returns empty_p_block_v when text-p prompt is empty even if video has OLD', () => {
  const result = resolveCompositionVideoPrompt(
    {
      nodes: [
        node('image-i0', 'image'),
        node('image-look-0', 'image'),
        node('text-p', 'text', { prompt: '   ' }),
        node('video-v', 'video', { prompt: 'OLD' }),
      ],
      compositionRunGroup: runGroup(['image-i0', 'image-look-0', 'text-p', 'video-v']),
    },
    'video-v',
  )
  expect(result).toEqual({ error: 'empty_p_block_v' })
})

it('reads first run-group text node when text-p is absent', () => {
  const result = resolveCompositionVideoPrompt(
    {
      nodes: [
        node('image-i0', 'image'),
        node('story-b', 'text', { prompt: 'SECOND' }),
        node('story-a', 'text', { prompt: 'FIRST SCRIPT' }),
        node('video-v', 'video', { prompt: 'OLD' }),
      ],
      compositionRunGroup: {
        nodeIds: ['image-i0', 'story-a', 'story-b', 'video-v'],
        dumpHash: 'h1',
        createdAt: '2026-09-16T00:00:00.000Z',
      },
    },
    'video-v',
  )
  expect(result).toEqual({ prompt: 'FIRST SCRIPT' })
})

it('returns empty_p_block_v when run-group text node is empty', () => {
  const result = resolveCompositionVideoPrompt(
    {
      nodes: [
        node('story-a', 'text', { content: '' }),
        node('video-v', 'video', { prompt: 'OLD' }),
      ],
      compositionRunGroup: {
        nodeIds: ['story-a', 'video-v'],
        dumpHash: 'h1',
        createdAt: '2026-09-16T00:00:00.000Z',
      },
    },
    'video-v',
  )
  expect(result).toEqual({ error: 'empty_p_block_v' })
})

it('falls back to video node prompt when no P block exists', () => {
  const result = resolveCompositionVideoPrompt(
    {
      nodes: [node('video-v', 'video', { prompt: '  standalone  ' })],
    },
    'video-v',
  )
  expect(result).toEqual({ prompt: 'standalone' })
})

it('does not steal text-p when the video is outside the run group', () => {
  const result = resolveCompositionVideoPrompt(
    {
      nodes: [
        node('text-p', 'text', { prompt: 'COMPOSITION SCRIPT' }),
        node('video-other', 'video', { prompt: 'OWN PROMPT' }),
      ],
      compositionRunGroup: runGroup(['text-p', 'video-v']),
    },
    'video-other',
  )
  expect(result).toEqual({ prompt: 'OWN PROMPT' })
})

it('does not steal text-p when run group is missing', () => {
  const result = resolveCompositionVideoPrompt(
    {
      nodes: [
        node('text-p', 'text', { prompt: 'COMPOSITION SCRIPT' }),
        node('video-v', 'video', { prompt: 'OWN PROMPT' }),
      ],
    },
    'video-v',
  )
  expect(result).toEqual({ prompt: 'OWN PROMPT' })
})

it('empty text-p does not block a video outside the run group', () => {
  const result = resolveCompositionVideoPrompt(
    {
      nodes: [
        node('text-p', 'text', { prompt: '' }),
        node('video-other', 'video', { prompt: 'OWN PROMPT' }),
      ],
      compositionRunGroup: runGroup(['text-p', 'video-v']),
    },
    'video-other',
  )
  expect(result).toEqual({ prompt: 'OWN PROMPT' })
})

it('returns empty prompt when video node is missing and there is no P block', () => {
  const result = resolveCompositionVideoPrompt({ nodes: [node('image-i0', 'image')] }, 'video-v')
  expect(result).toEqual({ prompt: '' })
})

it('reads text-p content when prompt is empty', () => {
  const result = resolveCompositionVideoPrompt(
    {
      nodes: [
        node('text-p', 'text', { prompt: '', content: ' FROM CONTENT ' }),
        node('video-v', 'video', { prompt: 'OLD' }),
      ],
      compositionRunGroup: runGroup(['text-p', 'video-v']),
    },
    'video-v',
  )
  expect(result).toEqual({ prompt: 'FROM CONTENT' })
})
