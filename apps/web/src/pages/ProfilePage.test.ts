import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import ProfilePage from './ProfilePage.vue'

const { routerMocks, routeQuery } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
  },
  routeQuery: {} as Record<string, string>,
}))

vi.mock('vue-router', () => ({
  useRouter: () => routerMocks,
  useRoute: () => ({ query: routeQuery }),
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

async function mountProfile() {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.token = 'tok'
  auth.user = { id: '1', phone: '17200008608', nickname: '测', points: 34, membership: 'free' } as never
  const wrapper = mount(ProfilePage)
  await flushPromises()
  return wrapper
}

describe('ProfilePage', () => {
  beforeEach(() => {
    Object.keys(routeQuery).forEach((key) => {
      delete routeQuery[key]
    })
    routerMocks.push.mockClear()
    routerMocks.back.mockClear()
    routerMocks.replace.mockClear()
  })

  it('defaults to the account tab with identity copy', async () => {
    const wrapper = await mountProfile()

    expect(wrapper.text()).toContain('账户')
    expect(wrapper.text()).toContain('创作能量')
    expect(wrapper.text()).toContain('我的邀请码')
    expect(wrapper.text()).toContain('充值')
  })

  it('renders insight KPI labels on the billing tab', async () => {
    routeQuery.tab = 'billing'
    const wrapper = await mountProfile()

    expect(wrapper.text()).toContain('积分账单')
    expect(wrapper.text()).toContain('净消耗')
    expect(wrapper.text()).toContain('单日峰值')
    expect(wrapper.text()).toContain('全部')
    expect(wrapper.text()).toContain('消耗')
  })

  it('exposes a close control with aria-label 关闭', async () => {
    const wrapper = await mountProfile()

    expect(wrapper.find('[aria-label="关闭"]').exists()).toBe(true)
  })
})
