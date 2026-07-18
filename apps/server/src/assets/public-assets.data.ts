export interface PublicAssetItem {
  id: string
  url: string
  label: string
  kind: 'image' | 'video' | 'audio'
  publishedAt: string
}

/** 平台发布的公共资产，供所有用户在画布资产库中调用 */
export const PUBLIC_ASSETS: PublicAssetItem[] = [
  {
    id: 'pub-img-001',
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&q=80',
    label: '流体渐变背景',
    kind: 'image',
    publishedAt: '2026-07-10T08:00:00.000Z',
  },
  {
    id: 'pub-img-002',
    url: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=1200&q=80',
    label: '星际粒子',
    kind: 'image',
    publishedAt: '2026-07-10T08:00:00.000Z',
  },
  {
    id: 'pub-img-003',
    url: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?w=1200&q=80',
    label: '紫色霓虹抽象',
    kind: 'image',
    publishedAt: '2026-07-02T08:00:00.000Z',
  },
  {
    id: 'pub-img-004',
    url: 'https://images.unsplash.com/photo-1614728263932-097ed562d636?w=1200&q=80',
    label: '深空行星',
    kind: 'image',
    publishedAt: '2026-07-02T08:00:00.000Z',
  },
  {
    id: 'pub-img-005',
    url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1200&q=80',
    label: '彩虹渐变',
    kind: 'image',
    publishedAt: '2026-06-20T08:00:00.000Z',
  },
  {
    id: 'pub-img-006',
    url: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=1200&q=80',
    label: '蓝紫波纹',
    kind: 'image',
    publishedAt: '2026-06-20T08:00:00.000Z',
  },
  {
    id: 'pub-vid-001',
    url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    label: '示例短片·Big Buck Bunny',
    kind: 'video',
    publishedAt: '2026-07-05T08:00:00.000Z',
  },
  {
    id: 'pub-vid-002',
    url: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    label: '示例短片·Escapes',
    kind: 'video',
    publishedAt: '2026-06-28T08:00:00.000Z',
  },
  {
    id: 'pub-aud-001',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    label: '示例配乐·Helix 1',
    kind: 'audio',
    publishedAt: '2026-07-05T08:00:00.000Z',
  },
  {
    id: 'pub-aud-002',
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    label: '示例配乐·Helix 2',
    kind: 'audio',
    publishedAt: '2026-06-28T08:00:00.000Z',
  },
]
