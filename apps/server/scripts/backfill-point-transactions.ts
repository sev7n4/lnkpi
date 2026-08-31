import { PrismaClient } from '@prisma/client'
import { resolveBackfillFields } from '../src/points/backfill-fields'

const prisma = new PrismaClient()

// Run once immediately after the schema migration, before heavy new traffic:
// DATABASE_URL='file:./prisma/dev.db' pnpm backfill:point-transactions
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
      const fields = resolveBackfillFields(row)
      if (!fields) continue
      await prisma.pointTransaction.update({
        where: { id: row.id },
        data: fields,
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
