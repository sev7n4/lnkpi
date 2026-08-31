import { api } from './api'
import type { Work } from '@lnkpi/shared'

export interface CreatorProfile {
  user: {
    id: string
    nickname: string
    avatar?: string
    points: number
    membership: string
    workCount: number
    createdAt: string
  }
  works: Work[]
}

export const usersApi = {
  getCreator: (id: string) => api.get<{ data: CreatorProfile }>(`/users/${id}`),
}

export interface MembershipPlan {
  id: string
  name: string
  points: number
  price: number
  features: string[]
}

export type PointsRangeKey = '7d' | 'month' | 'all'
export type PointKind = 'consume' | 'refund' | 'grant'
export type PointCategory = 'text' | 'image' | 'audio' | 'video' | 'other'

export interface PointTransactionItem {
  id: string
  amount: number
  reason: string
  createdAt: string
  kind: PointKind
  category: PointCategory
  status: string | null
  model: string | null
  generationId: string | null
  balanceAfter: number | null
}

export interface PointsSummary {
  range: PointsRangeKey
  from: string | null
  to: string
  byCategory: Record<'text' | 'image' | 'audio' | 'video', number>
  otherNetConsumed: number
  refundTotal: number
  grantTotal: number
}

export const membershipApi = {
  getPlans: () => api.get<{ data: MembershipPlan[] }>('/membership/plans'),
  getPoints: () => api.get<{ data: { points: number; membership: string } }>('/membership/points'),
  claimDaily: () => api.post<{ data: { points: number; added: number } }>('/membership/claim-daily'),
  upgrade: (plan: string) => api.post<{ data: { membership: string; points: number } }>('/membership/upgrade', { plan }),
  transactions: (params?: {
    range?: PointsRangeKey
    kind?: PointKind
    category?: PointCategory
    cursor?: string
    limit?: number
  }) =>
    api.get<{
      data: { items: PointTransactionItem[]; nextCursor: string | null; from: string | null; to: string }
    }>('/membership/transactions', { params }),
  pointsSummary: (range?: PointsRangeKey) =>
    api.get<{ data: PointsSummary }>('/membership/points-summary', { params: { range } }),
}
