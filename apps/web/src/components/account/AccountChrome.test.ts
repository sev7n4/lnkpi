import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import AccountChrome from './AccountChrome.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/components/membership/MembershipModal.vue', () => ({
  default: {
    props: ['modelValue'],
    template: '<div class="membership-modal-stub" :data-open="modelValue" />',
  },
}))

function mountChrome(loggedIn: boolean) {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  if (loggedIn) {
    auth.user = { id: '1', phone: '13800000000', nickname: 'Neo', points: 420, membership: 'free' } as never
    auth.token = 'tok'
  }
  const wrapper = mount(AccountChrome, {
    global: { plugins: [pinia] },
  })
  return { wrapper, auth }
}

describe('AccountChrome', () => {
  it('renders a login button when logged out', async () => {
    const { wrapper, auth } = mountChrome(false)
    const login = wrapper.find('button')
    expect(login.text()).toBe('登录')
    expect(wrapper.find('.account-points-pill').exists()).toBe(false)
    auth.openLogin = vi.fn()
    await login.trigger('click')
    expect(auth.openLogin).toHaveBeenCalled()
  })

  it('renders points pill and user menu when logged in', () => {
    const { wrapper } = mountChrome(true)
    const pillText = wrapper.find('.account-points-pill').text()
    expect(pillText).toContain('420')
    expect(pillText).toContain('积分')
    expect(wrapper.find('.account-user-menu').exists()).toBe(true)
    expect(wrapper.find('.membership-modal-stub').exists()).toBe(true)
  })

  it('opens membership modal from the points pill', async () => {
    const { wrapper } = mountChrome(true)
    expect(wrapper.find('.membership-modal-stub').attributes('data-open')).toBe('false')
    await wrapper.find('.account-points-pill').trigger('click')
    expect(wrapper.find('.membership-modal-stub').attributes('data-open')).toBe('true')
  })
})
