import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import ProfilePage from './ProfilePage.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/services/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      data: { data: { nickname: '测', phone: '172****8608', points: 34, membership: 'free' } },
    }),
  },
}))

vi.mock('@/services/users-api', () => ({
  membershipApi: {
    pointsSummary: vi.fn().mockResolvedValue({
      data: {
        data: {
          range: 'month',
          from: null,
          to: new Date().toISOString(),
          byCategory: { text: 0, image: 20, audio: 0, video: 0 },
          otherNetConsumed: 0,
          refundTotal: 0,
          grantTotal: 0,
          insights: {
            netConsumedTotal: 20,
            peakDayConsumed: 20,
            avgDailyConsumed: 1,
            activeDays: 1,
            longestStreakDays: 1,
          },
        },
      },
    }),
    transactions: vi.fn().mockResolvedValue({
      data: { data: { items: [], nextCursor: null, from: null, to: new Date().toISOString() } },
    }),
  },
}))

vi.mock('@/components/membership/MembershipModal.vue', () => ({
  default: { template: '<div class="membership-modal-stub" />' },
}))

describe('ProfilePage', () => {
  it('renders insight KPI labels and recharge CTA', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.token = 'tok'
    auth.user = { id: '1', phone: '17200008608', nickname: '测', points: 34, membership: 'free' } as never

    const wrapper = mount(ProfilePage)
    await flushPromises()

    expect(wrapper.text()).toContain('净消耗')
    expect(wrapper.text()).toContain('单日峰值')
    expect(wrapper.text()).toContain('充值')
    expect(wrapper.text()).toContain('全部')
    expect(wrapper.text()).toContain('消耗')
  })
})
