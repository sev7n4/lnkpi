import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import MembershipModal from './MembershipModal.vue'

vi.mock('@/services/users-api', () => ({
  membershipApi: {
    getPlans: vi.fn(async () => ({ data: { data: [] } })),
    getPoints: vi.fn(async () => ({ data: { data: { points: 0, membership: 'free' } } })),
    claimDaily: vi.fn(),
    upgrade: vi.fn(),
  },
}))

describe('MembershipModal', () => {
  it('enables append-to-body so canvas chrome cannot trap dialog clicks', () => {
    const pinia = createPinia()
    const wrapper = mount(MembershipModal, {
      props: { modelValue: false },
      global: {
        plugins: [pinia],
        stubs: {
          ElDialog: {
            props: {
              modelValue: Boolean,
              appendToBody: Boolean,
            },
            template: '<div class="el-dialog-stub" :data-append-to-body="String(appendToBody)" />',
          },
        },
      },
    })
    // Vue normalizes append-to-body → appendToBody on the component
    const dialog = wrapper.findComponent({ name: 'ElDialog' })
    if (dialog.exists()) {
      expect(dialog.props('appendToBody')).toBe(true)
    } else {
      expect(wrapper.find('.el-dialog-stub').attributes('data-append-to-body')).toBe('true')
    }
    wrapper.unmount()
  })
})
