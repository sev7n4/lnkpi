import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import ProfilePage from './ProfilePage.vue'

const { routerMocks, routeQuery, membershipMocks, apiGet } = vi.hoisted(() => ({
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
  apiGet: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => routerMocks,
  useRoute: () => ({ query: routeQuery }),
}))

vi.mock('@/services/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
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

const allDaysPayload = {
  data: {
    data: {
      range: 'all',
      from: '1970-01-01',
      to: '2026-09-16',
      days: [
        {
          date: '2026-09-16',
          generationCount: 2,
          netConsumed: 20,
          byCategory: { text: 0, image: 20, audio: 0, video: 0 },
          otherNetConsumed: 0,
        },
      ],
    },
  },
}

function usageDaysWithMarker(range: string, from: string, to: string, date: string, generationCount: number) {
  return {
    data: {
      data: {
        range,
        from,
        to,
        days: [
          {
            date,
            generationCount,
            netConsumed: generationCount,
            byCategory: { text: 0, image: 0, audio: 0, video: 0 },
            otherNetConsumed: 0,
          },
        ],
      },
    },
  }
}

const stale7dDaysPayload = usageDaysWithMarker('7d', '2026-01-01', '2026-01-07', '2026-01-07', 7)
const fresh30dDaysPayload = usageDaysWithMarker('30d', '2026-08-01', '2026-08-30', '2026-08-20', 3)

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

async function mountUsageWithOverlappingDaysRequests() {
  let settleStale7d: (value: unknown) => void = () => {}
  let rejectStale7d: (reason?: unknown) => void = () => {}
  const stale7dRequest = new Promise((resolve, reject) => {
    settleStale7d = resolve
    rejectStale7d = reject
  })
  let settle30d: (value: unknown) => void = () => {}
  const pending30d = new Promise((resolve) => {
    settle30d = resolve
  })

  membershipMocks.usageDays
    .mockImplementationOnce((range?: string) => {
      if (range === 'all') return Promise.resolve(allDaysPayload)
      return stale7dRequest
    })
    .mockImplementation((range?: string) => {
      if (range === 'all') return Promise.resolve(allDaysPayload)
      return pending30d
    })

  routeQuery.tab = 'usage'
  const wrapper = await mountProfile()
  expect(membershipMocks.usageDays).toHaveBeenCalledTimes(2)

  await wrapper.get('[data-range="30d"]').trigger('click')
  await flushPromises()
  expect(membershipMocks.usageDays).toHaveBeenCalledTimes(3)
  expect(membershipMocks.usageDays).toHaveBeenLastCalledWith('30d')

  return { wrapper, settleStale7d, rejectStale7d, settle30d }
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
    apiGet.mockReset()
    apiGet.mockResolvedValue({
      data: { data: { nickname: '测', phone: '172****8608', points: 34, membership: 'free' } },
    })
    membershipMocks.usage.mockResolvedValue(usagePayload)
    membershipMocks.usageDays.mockImplementation((range?: string) => {
      if (range === 'all') return Promise.resolve(allDaysPayload)
      return Promise.resolve(usageDaysPayload)
    })
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

  it('stretches account cards to the same max width as usage', async () => {
    const wrapper = await mountProfile()
    const identity = wrapper.find('[data-account-cards]')

    expect(identity.exists()).toBe(true)
    expect(identity.classes()).not.toContain('max-w-3xl')
    expect(wrapper.find('.max-w-6xl').exists()).toBe(true)
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
    expect(membershipMocks.usageDays).toHaveBeenCalledTimes(2)
    expect(membershipMocks.usageDays).toHaveBeenCalledWith('7d')
    expect(membershipMocks.usageDays).toHaveBeenCalledWith('all')
  })

  it('treats tab=usage as the usage panel', async () => {
    routeQuery.tab = 'usage'
    const wrapper = await mountProfile()
    expect(wrapper.text()).toContain('用量总览')
  })

  it.each(['billing', 'usage'] as const)(
    'shows usage skeletons instead of empty copy while %s deep-link requests hang',
    async (tab) => {
      apiGet.mockReturnValue(new Promise(() => {}))
      membershipMocks.usage.mockReturnValue(new Promise(() => {}))
      membershipMocks.usageDays.mockReturnValue(new Promise(() => {}))
      routeQuery.tab = tab

      const wrapper = await mountProfile()

      expect(wrapper.text()).not.toContain('还没有消耗')
      expect(wrapper.find('.h-48.animate-pulse').exists()).toBe(true)
    },
  )

  it('does not fetch usage on the account tab', async () => {
    await mountProfile()
    expect(membershipMocks.usage).not.toHaveBeenCalled()
    expect(membershipMocks.usageDays).not.toHaveBeenCalled()
  })

  it('refetches only the trend window when the range changes', async () => {
    routeQuery.tab = 'billing'
    const wrapper = await mountProfile()
    expect(membershipMocks.usage).toHaveBeenCalledTimes(1)
    expect(membershipMocks.usageDays).toHaveBeenCalledTimes(2)
    expect(membershipMocks.usageDays).toHaveBeenCalledWith('all')

    await wrapper.get('[data-range="30d"]').trigger('click')
    await flushPromises()

    expect(membershipMocks.usage).toHaveBeenCalledTimes(1)
    expect(membershipMocks.usageDays).toHaveBeenCalledTimes(3)
    expect(membershipMocks.usageDays).toHaveBeenLastCalledWith('30d')
    expect(membershipMocks.usageDays.mock.calls.filter((call) => call[0] === 'all')).toHaveLength(1)
  })

  it('ignores a stale 7d usageDays success after switching to 30d', async () => {
    const { wrapper, settleStale7d, settle30d } = await mountUsageWithOverlappingDaysRequests()

    settle30d(fresh30dDaysPayload)
    await flushPromises()
    expect(wrapper.text()).toContain('2026-08-20')

    settleStale7d(stale7dDaysPayload)
    await flushPromises()

    expect(wrapper.text()).toContain('2026-08-20')
    expect(wrapper.text()).not.toContain('2026-01-07')
    expect(wrapper.text()).not.toContain('用量趋势加载失败，请稍后重试')
  })

  it('ignores a stale 7d usageDays rejection after 30d has succeeded', async () => {
    const { wrapper, rejectStale7d, settle30d } = await mountUsageWithOverlappingDaysRequests()

    settle30d(fresh30dDaysPayload)
    await flushPromises()
    expect(wrapper.text()).toContain('2026-08-20')

    rejectStale7d(new Error('stale 7d'))
    await flushPromises()

    expect(wrapper.text()).toContain('2026-08-20')
    expect(wrapper.text()).not.toContain('2026-01-07')
    expect(wrapper.text()).not.toContain('用量趋势加载失败，请稍后重试')
  })

  it('exposes a close control with aria-label 关闭', async () => {
    const wrapper = await mountProfile()

    expect(wrapper.find('[aria-label="关闭"]').exists()).toBe(true)
  })
})
