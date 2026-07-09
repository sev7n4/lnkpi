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

export const membershipApi = {
  getPlans: () => api.get<{ data: MembershipPlan[] }>('/membership/plans'),
  getPoints: () => api.get<{ data: { points: number; membership: string } }>('/membership/points'),
  claimDaily: () => api.post<{ data: { points: number; added: number } }>('/membership/claim-daily'),
  upgrade: (plan: string) => api.post<{ data: { membership: string; points: number } }>('/membership/upgrade', { plan }),
  transactions: () => api.get<{ data: Array<{ id: string; amount: number; reason: string; createdAt: string }> }>('/membership/transactions'),
}
