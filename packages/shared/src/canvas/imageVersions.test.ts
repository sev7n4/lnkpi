import { describe, expect, it } from 'vitest'
import {
  appendEditVersion,
  currentImageVersion,
  revertImageVersion,
  seedImageVersions,
} from './imageVersions'

describe('seedImageVersions', () => {
  it('inserts version 1 when chain is empty and url exists', () => {
    const next = seedImageVersions(
      { url: 'https://cdn/a.png', generationRecordId: 'g1' },
      { id: 'v1', now: '2026-08-18T00:00:00.000Z', source: 'generate' },
    )
    expect(next.imageVersions).toHaveLength(1)
    expect(next.currentVersionId).toBe('v1')
    expect(next.imageVersions?.[0]).toMatchObject({
      url: 'https://cdn/a.png',
      source: 'generate',
      generationRecordId: 'g1',
    })
  })

  it('is a no-op when versions already exist', () => {
    const seeded = seedImageVersions(
      { url: 'https://cdn/a.png' },
      { id: 'v1', now: '2026-08-18T00:00:00.000Z' },
    )
    const again = seedImageVersions(seeded, { id: 'v2', now: '2026-08-18T01:00:00.000Z' })
    expect(again.imageVersions).toHaveLength(1)
    expect(again.currentVersionId).toBe('v1')
  })
})

describe('appendEditVersion', () => {
  it('appends edit version and updates current url', () => {
    const seeded = seedImageVersions(
      { url: 'https://cdn/a.png', generationRecordId: 'g1' },
      { id: 'v1', now: '2026-08-18T00:00:00.000Z' },
    )
    const next = appendEditVersion(seeded, {
      id: 'v2',
      url: 'https://cdn/b.png',
      createdAt: '2026-08-18T00:01:00.000Z',
      generationRecordId: 'g2',
      editPrompt: '去污渍',
    })
    expect(next.url).toBe('https://cdn/b.png')
    expect(next.currentVersionId).toBe('v2')
    expect(next.generationRecordId).toBe('g2')
    expect(next.imageVersions).toHaveLength(2)
    expect(next.imageVersions?.[1]).toMatchObject({
      source: 'edit',
      parentVersionId: 'v1',
      editPrompt: '去污渍',
    })
  })
})

describe('revertImageVersion', () => {
  it('restores url without deleting later versions', () => {
    const seeded = seedImageVersions(
      { url: 'https://cdn/a.png', generationRecordId: 'g1' },
      { id: 'v1', now: '2026-08-18T00:00:00.000Z' },
    )
    const edited = appendEditVersion(seeded, {
      id: 'v2',
      url: 'https://cdn/b.png',
      createdAt: '2026-08-18T00:01:00.000Z',
      generationRecordId: 'g2',
      editPrompt: '去污渍',
    })
    const reverted = revertImageVersion(edited, 'v1')
    expect(reverted.url).toBe('https://cdn/a.png')
    expect(reverted.currentVersionId).toBe('v1')
    expect(reverted.generationRecordId).toBe('g1')
    expect(reverted.imageVersions).toHaveLength(2)
    expect(currentImageVersion(reverted)?.id).toBe('v1')
  })
})
