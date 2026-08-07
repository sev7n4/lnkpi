import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentAssetPicker from './AgentAssetPicker.vue'

vi.mock('@/services/assets-api', () => ({
  assetsApi: {
    listMine: vi.fn().mockResolvedValue({
      data: {
        data: {
          items: [{
            id: 'asset-1',
            url: 'https://cdn.example.com/reference.png',
            label: '角色参考',
            kind: 'image',
            createdAt: '2026-08-07T00:00:00.000Z',
          }],
        },
      },
    }),
  },
}))

describe('AgentAssetPicker', () => {
  it('emits the selected asset as a sidebar asset attachment', async () => {
    const wrapper = mount(AgentAssetPicker, {
      props: { open: true },
      global: {
        stubs: { Teleport: true },
      },
    })

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('角色参考')
    })
    await wrapper.get('[data-testid="agent-asset-option"]').trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[
      {
        id: 'asset-1',
        mediaType: 'image',
        sourceKind: 'asset',
        label: '角色参考',
        url: 'https://cdn.example.com/reference.png',
      },
    ]])
  })
})
