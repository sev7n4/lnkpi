import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const MOCK_COVERS = [
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=80',
  'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&q=80',
  'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=800&q=80',
  'https://images.unsplash.com/photo-1614728263932-097ed562d636?w=800&q=80',
  'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=800&q=80',
  'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=800&q=80',
  'https://images.unsplash.com/photo-1557683316-973673baf926?w=800&q=80',
  'https://images.unsplash.com/photo-1614850523459-c2f4c699c52e?w=800&q=80',
]

const MOCK_TITLES = [
  '浮光·火星激战篇I', '元启录', '《万物生：问心》', '万物生',
  '网络小说《末日乐园》改编', '绝尘', '救赎：长河余烬', '《断线》',
]

const MOCK_AUTHORS = ['草帽小蔡', '命比梦长', '孙晨熙', 'Evkinger', 'GiGI', '静水', '老蛙Alex', 'VENYU']

async function main() {
  const user = await prisma.user.upsert({
    where: { phone: '13800000000' },
    update: {},
    create: { phone: '13800000000', nickname: '演示用户' },
  })

  for (let i = 0; i < MOCK_TITLES.length; i++) {
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        title: MOCK_TITLES[i],
        canvasData: JSON.stringify({ nodes: [], edges: [] }),
      },
    })

    await prisma.work.create({
      data: {
        title: MOCK_TITLES[i],
        coverUrl: MOCK_COVERS[i],
        type: i % 3 === 0 ? 'shortfilm' : 'canvas',
        authorId: user.id,
        sessionId: session.id,
        likes: Math.floor(Math.random() * 1000),
        views: Math.floor(Math.random() * 5000),
        category: i < 2 ? '2026-赛事' : '精选作品',
      },
    })
  }

  console.log('✅ Seed data created')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
