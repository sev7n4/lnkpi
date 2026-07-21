import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import CanvasAccountChrome from './CanvasAccountChrome.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/components/membership/MembershipModal.vue', () => ({
  default: { template: '<div class="membership-modal-stub" />' },
}))

describe('CanvasAccountChrome', () => {
  it('renders points from auth store', () => {
    const pinia = createPinia()
    const auth = useAuthStore(pinia)
    auth.user = { id: '1', phone: '13800000000', nickname: 'Neo', points: 420, membership: 'free' } as never
    auth.token = 'tok'

    const wrapper = mount(CanvasAccountChrome, {
      global: { plugins: [pinia] },
    })

    const pillText = wrapper.find('.canvas-points-pill').text()
    expect(pillText).toContain('420')
    expect(pillText).toContain('积分')
  })
})
