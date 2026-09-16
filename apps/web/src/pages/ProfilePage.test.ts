import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import ProfilePage from './ProfilePage.vue'

const { routerMocks, routeQuery, membershipMocks } = vi.hoisted(() => ({
  routerMocks: {
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
  },
  routeQuery: {} as Record<string, string>,
  membershipMocks: {
    usage: vi.fn(),
    usageDays: vi.fn(),
    transactions: vi.fn(),
  },
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
    usage: (...args: unknown[]) => membershipMocks.usage(...args),
    usageDays: (...args: unknown[]) => membershipMocks.usageDays(...args),
    transactions: (...args: unknown[]) => membershipMocks.transactions(...args),
  },
}))

vi.mock('@/components/membership/MembershipModal.vue', () => ({
  default: { template: '<div class="membership-modal-stub" />' },
}))

const usagePayload = {
  data: {
    data: {
      overview: {
        netConsumedTotal: 20,
        byCategory: { text: 0, image: 20, audio: 0, video: 0 },
        otherNetConsumed: 0,
        generationCount: 3,
        activeDays: 5,
      },
      heatmap: {
        from: '2026-03-16',
        to: '2026-09-16',
        activeDays: 1,
        days: [{ date: '2026-09-16', netConsumed: 20, generationCount: 1 }],
      },
    },
  },
}

const usageDaysPayload = {
  data: {
    data: {
      range: '7d',
      from: '2026-09-10',
      to: '2026-09-16',
      days: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-09-${String(10 + i).padStart(2, '0')}`,
        generationCount: 0,
        netConsumed: 0,
        byCategory: { text: 0, image: 0, audio: 0, video: 0 },
        otherNetConsumed: 0,
      })),
    },
  },
}

async function mountProfile() {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.token = 'tok'
  auth.user = { id: '1', phone: '17200008608', nickname: '测', points: 34, membership: 'free' } as never
  const wrapper = mount(ProfilePage, {
    global: {
      stubs: {
        RouterLink: {
          props: ['to'],
          template: '<a :href="typeof to === \'string\' ? to : \'\'"><slot /></a>',
        },
      },
    },
  })
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
    membershipMocks.usage.mockReset()
    membershipMocks.usageDays.mockReset()
    membershipMocks.transactions.mockReset()
    membershipMocks.usage.mockResolvedValue(usagePayload)
    membershipMocks.usageDays.mockResolvedValue(usageDaysPayload)
    membershipMocks.transactions.mockResolvedValue({
      data: { data: { items: [], nextCursor: null, from: null, to: new Date().toISOString() } },
    })
  })

  it('defaults to the account tab with identity copy', async () => {
    const wrapper = await mountProfile()

    expect(wrapper.text()).toContain('账户')
    expect(wrapper.text()).toContain('创作能量')
    expect(wrapper.text()).toContain('我的邀请码')
    expect(wrapper.text()).toContain('充值')
  })

  it('renders usage overview on billing and usage query tabs', async () => {
    routeQuery.tab = 'billing'
    const wrapper = await mountProfile()
    expect(wrapper.text()).toContain('用量')
    expect(wrapper.text()).toContain('用量总览')
    expect(wrapper.text()).toContain('净消耗积分')
    expect(wrapper.text()).toContain('累计活跃')
    expect(wrapper.text()).not.toContain('积分账单')
    expect(wrapper.text()).not.toContain('单日峰值')
    expect(membershipMocks.usage).toHaveBeenCalledTimes(1)
    expect(membershipMocks.usageDays).toHaveBeenCalledTimes(1)
  })

  it('treats tab=usage as the usage panel', async () => {
    routeQuery.tab = 'usage'
    const wrapper = await mountProfile()
    expect(wrapper.text()).toContain('用量总览')
  })

  it('does not fetch usage on the account tab', async () => {
    await mountProfile()
    expect(membershipMocks.usage).not.toHaveBeenCalled()
    expect(membershipMocks.usageDays).not.toHaveBeenCalled()
  })

  it('refetches only usageDays when the trend range changes', async () => {
    routeQuery.tab = 'billing'
    const wrapper = await mountProfile()
    expect(membershipMocks.usage).toHaveBeenCalledTimes(1)
    expect(membershipMocks.usageDays).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-range="30d"]').trigger('click')
    await flushPromises()

    expect(membershipMocks.usage).toHaveBeenCalledTimes(1)
    expect(membershipMocks.usageDays).toHaveBeenCalledTimes(2)
    expect(membershipMocks.usageDays).toHaveBeenLastCalledWith('30d')
  })

  it('exposes a close control with aria-label 关闭', async () => {
    const wrapper = await mountProfile()

    expect(wrapper.find('[aria-label="关闭"]').exists()).toBe(true)
  })
})
