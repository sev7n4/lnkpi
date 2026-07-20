import { beforeEach, describe, expect, it, vi } from 'vitest'
import { studioApi } from '@/services/studio-api'
import { useGenerationPolling } from '@/composables/useGenerationPolling'

vi.mock('@/services/studio-api', () => ({
  studioApi: {
    getGeneration: vi.fn(),
  },
}))

describe('useGenerationPolling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not call onUpdate for tasks removed during poll await', async () => {
    let resolveFetch!: (v: unknown) => void
    const hang = new Promise((r) => {
      resolveFetch = r
    })
    vi.mocked(studioApi.getGeneration).mockImplementationOnce(() => hang as never)

    const onUpdate = vi.fn()
    const polling = useGenerationPolling(onUpdate)
    polling.start([{ recordId: 'rec-1', nodeId: 'node-1' }])

    await Promise.resolve()
    expect(studioApi.getGeneration).toHaveBeenCalledWith('rec-1')

    polling.removeByNodeId('node-1')

    resolveFetch({
      data: {
        data: {
          id: 'rec-1',
          type: 'image',
          prompt: 'x',
          status: 'completed',
          url: 'https://example.com/late.png',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(onUpdate).not.toHaveBeenCalled()
  })
})
