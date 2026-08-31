import { PrismaClient } from '@prisma/client'
import { mapReasonToPointFields } from '../src/points/reason-map'

const prisma = new PrismaClient()

async function main() {
  const batchSize = 200
  let cursor: string | undefined
  let updated = 0

  for (;;) {
    const rows = await prisma.pointTransaction.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    })
    if (!rows.length) break

    for (const row of rows) {
      const mapped = mapReasonToPointFields(row.reason, row.amount)
      await prisma.pointTransaction.update({
        where: { id: row.id },
        data: {
          kind: mapped.kind,
          category: mapped.category,
          status: mapped.status,
        },
      })
      updated++
    }

    cursor = rows[rows.length - 1].id
  }

  console.log(`backfilled ${updated} rows`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
