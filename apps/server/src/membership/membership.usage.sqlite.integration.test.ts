import 'reflect-metadata'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaService } from '../prisma/prisma.service'
import { MembershipService } from './membership.service'

const serverRoot = path.resolve(__dirname, '../..')

describe('MembershipService usage against real SQLite DateTime', () => {
  let dir: string
  let prisma: PrismaClient
  let service: MembershipService

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lnkpi-usage-sqlite-'))
    const dbPath = path.join(dir, 'test.db')
    const databaseUrl = `file:${dbPath}`
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    })
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    service = new MembershipService(prisma as PrismaService)
  })

  afterAll(async () => {
    await prisma.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  it('buckets millisecond createdAt into Shanghai calendar days, not a null day', async () => {
    const now = new Date('2026-09-16T12:00:00.000Z')
    await prisma.user.create({ data: { id: 'u-sqlite', phone: '17200001111', nickname: 'sqlite' } })
    await prisma.pointTransaction.create({
      data: {
        userId: 'u-sqlite',
        amount: -20,
        reason: 'gen',
        kind: 'consume',
        category: 'image',
        generationId: 'g1',
        createdAt: new Date('2026-09-16T10:00:00.000Z'),
      },
    })

    const usage = await service.usage('u-sqlite', now)
    expect(usage.overview.generationCount).toBe(1)
    expect(usage.overview.activeDays).toBe(1)
    expect(usage.heatmap.days).toEqual([{ date: '2026-09-16', netConsumed: 20, generationCount: 1 }])

    const month = await service.usageDays('u-sqlite', 'month', now)
    expect(month.days.find((day) => day.date === '2026-09-16')).toMatchObject({
      generationCount: 1,
      netConsumed: 20,
    })
    const week = await service.usageDays('u-sqlite', '7d', now)
    expect(week.days.find((day) => day.date === '2026-09-16')).toMatchObject({
      generationCount: 1,
      netConsumed: 20,
    })
  })

  it('puts UTC 16:30Z consume on the next Shanghai calendar day', async () => {
    const now = new Date('2026-09-16T18:00:00.000Z')
    await prisma.user.create({ data: { id: 'u-evening', phone: '17200002222', nickname: 'evening' } })
    await prisma.pointTransaction.create({
      data: {
        userId: 'u-evening',
        amount: -15,
        reason: 'late',
        kind: 'consume',
        category: 'video',
        generationId: 'g-late',
        createdAt: new Date('2026-09-16T16:30:00.000Z'),
      },
    })

    const usage = await service.usage('u-evening', now)
    expect(usage.heatmap.days).toEqual([{ date: '2026-09-17', netConsumed: 15, generationCount: 1 }])
    const days = await service.usageDays('u-evening', '7d', now)
    expect(days.to).toBe('2026-09-17')
    expect(days.days.find((day) => day.date === '2026-09-17')).toMatchObject({
      generationCount: 1,
      netConsumed: 15,
    })
  })
})
