import { beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import UsageDayTable from './UsageDayTable.vue'
import type { UsageDayPoint } from '@/services/users-api'

const { transactions } = vi.hoisted(() => ({
  transactions: vi.fn(),
}))

vi.mock('@/services/users-api', () => ({
  membershipApi: { transactions: (...args: unknown[]) => transactions(...args) },
}))

const consumeDay: UsageDayPoint = {
  date: '2026-09-16',
  generationCount: 2,
  netConsumed: 10,
  byCategory: { text: 0, image: 10, audio: 0, video: 0 },
  otherNetConsumed: 0,
}

const zeroDay: UsageDayPoint = {
  date: '2026-09-15',
  generationCount: 0,
  netConsumed: 0,
  byCategory: { text: 0, image: 0, audio: 0, video: 0 },
  otherNetConsumed: 0,
}

const olderDay: UsageDayPoint = {
  date: '2026-09-14',
  generationCount: 1,
  netConsumed: 5,
  byCategory: { text: 5, image: 0, audio: 0, video: 0 },
  otherNetConsumed: 0,
}

const ledgerItem = {
  id: 't1',
  reason: '生成',
  amount: -10,
  kind: 'consume' as const,
  category: 'image' as const,
  createdAt: '2026-09-16T01:00:00.000Z',
  model: 'x',
  generationId: 'g1',
  balanceAfter: 3,
  status: null,
}

function mockLedger(options?: { items?: typeof ledgerItem[]; nextCursor?: string | null }) {
  transactions.mockResolvedValue({
    data: {
      data: {
        items: options?.items ?? [ledgerItem],
        nextCursor: options && 'nextCursor' in options ? options.nextCursor : 'c1',
      },
    },
  })
}

function mountTable(days: UsageDayPoint[], loading?: boolean) {
  return mount(UsageDayTable, {
    props: loading === undefined ? { days } : { days, loading },
    global: {
      stubs: {
        RouterLink: {
          props: ['to'],
          template: '<a :href="typeof to === \'string\' ? to : \'\'"><slot /></a>',
        },
      },
    },
  })
}

beforeEach(() => {
  transactions.mockReset()
  mockLedger()
})

it('renders columns 日期 / 生成次数 / 积分消耗 / 文本 / 图片 / 音频 / 视频', () => {
  const wrapper = mountTable([consumeDay, zeroDay])
  expect(wrapper.text()).toContain('日期')
  expect(wrapper.text()).toContain('生成次数')
  expect(wrapper.text()).toContain('积分消耗')
  expect(wrapper.text()).toContain('文本')
  expect(wrapper.text()).toContain('图片')
  expect(wrapper.text()).toContain('音频')
  expect(wrapper.text()).toContain('视频')
})

it('hides zero-generation days and sorts date desc', () => {
  const wrapper = mountTable([zeroDay, olderDay, consumeDay])
  expect(wrapper.text()).toContain('2026-09-16')
  expect(wrapper.text()).toContain('2026-09-14')
  expect(wrapper.text()).not.toContain('2026-09-15')
  expect(wrapper.findAll('[data-day]').map((row) => row.attributes('data-day'))).toEqual([
    '2026-09-16',
    '2026-09-14',
  ])
})

it('empty state contains the copy and /workflow', () => {
  const wrapper = mountTable([zeroDay])
  expect(wrapper.text()).toContain('还没有消耗。去创作后，这里会按日汇总。')
  expect(wrapper.html()).toContain('/workflow')
})

it('clicking a row calls transactions with { day, limit: 50 }', async () => {
  const wrapper = mountTable([consumeDay, zeroDay])
  await wrapper.get('[data-day="2026-09-16"]').trigger('click')
  await flushPromises()
  expect(transactions).toHaveBeenCalledWith({ day: '2026-09-16', limit: 50 })
  expect(wrapper.get('[data-expanded]').text()).toContain('生成')
})

it('clicking the same row again collapses without a second fetch', async () => {
  const wrapper = mountTable([consumeDay, zeroDay])
  await wrapper.get('[data-day="2026-09-16"]').trigger('click')
  await flushPromises()
  expect(transactions).toHaveBeenCalledTimes(1)
  await wrapper.get('[data-day="2026-09-16"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('[data-expanded]').exists()).toBe(false)
  expect(transactions).toHaveBeenCalledTimes(1)
})

it('clicking a second row collapses the first (only one [data-expanded])', async () => {
  const wrapper = mountTable([consumeDay, olderDay])
  await wrapper.get('[data-day="2026-09-16"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-day="2026-09-14"]').trigger('click')
  await flushPromises()
  expect(wrapper.findAll('[data-expanded]')).toHaveLength(1)
  expect(transactions).toHaveBeenLastCalledWith({ day: '2026-09-14', limit: 50 })
})

it('load-more passes cursor', async () => {
  const wrapper = mountTable([consumeDay, zeroDay])
  await wrapper.get('[data-day="2026-09-16"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('加载更多')
  await wrapper.get('[data-expanded] button').trigger('click')
  await flushPromises()
  expect(transactions).toHaveBeenCalledWith({ day: '2026-09-16', limit: 50, cursor: 'c1' })
})

it('shows empty ledger copy after success with no items', async () => {
  mockLedger({ items: [], nextCursor: null })
  const wrapper = mountTable([consumeDay])
  await wrapper.get('[data-day="2026-09-16"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-expanded]').text()).toContain('这一天没有流水。')
})

it('keeps ledger error in the expanded area only', async () => {
  transactions.mockRejectedValue(new Error('network'))
  const wrapper = mountTable([consumeDay, zeroDay])
  await wrapper.get('[data-day="2026-09-16"]').trigger('click')
  await flushPromises()
  const expanded = wrapper.get('[data-expanded]')
  expect(expanded.text()).toContain('流水加载失败，请稍后重试')
  expect(wrapper.text()).toContain('2026-09-16')
  expect(wrapper.text()).toContain('日期')
  expect(wrapper.text()).not.toContain('2026-09-15')
})
