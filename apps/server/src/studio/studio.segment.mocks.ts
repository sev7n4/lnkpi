import { vi } from 'vitest'

/** sharp 元数据 mock（供 vi.mock('sharp') 工厂引用，避免提升问题）。 */
export const sharpMeta = vi.fn()
