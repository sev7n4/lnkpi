/**
 * 扩图（outpaint）画布几何纯函数。
 *
 * 坐标契约（对齐 Task 2 服务端 metadata / 下游 computeOutpaintLayers）：
 *  - rect.width / rect.height = 新画布尺寸（= outpaintTo）；
 *  - rect.x / rect.y = 原图左上角在新画布中的偏移（= beforeOffset，CompareView 贴图用）。
 *
 * 状态模型：**四条边的扩展量各自独立累积**。拖拽手柄只移动该手柄所在的边，对边固定：
 *  - 先向上扩 100、再向下扩 100 → 画布 400×500，原图落在 (0, 100)，上下两侧扩出区同时在。
 *
 * 这一点是 2026-09-22 线上缺陷的根因（用户：「先向上扩，再向下扩，之前向上扩出来的蒙版看不到了」）：
 * 旧模型只有 (新画布尺寸, anchor)，而 anchor 被「最后一次拖拽的手柄」整体覆盖，
 * 原图偏移由 anchor 重新解算 → 上一条边刚扩出来的区域被重新锚定吞掉。
 * 尺寸标量 + 三点锚定在数学上无法表达「上下都扩了」，必须改为逐边累积。
 *
 * 约束（规格 §3.1）：
 *  - 单边最小 OUTPAINT_MIN_EDGE（256px）：生成模型对过窄扩展效果差；
 *  - 面积上限 OUTPAINT_MAX_AREA_RATIO（9 倍原图面积）：不设单边 3 倍，避免挡住
 *    「宽不变、高拉 4 倍」的分镜板场景；
 *  - 新画布必须完整包含原图（扩图不裁剪），即四向扩展量恒 ≥ 0。
 */

export const OUTPAINT_MIN_EDGE = 256
export const OUTPAINT_MAX_AREA_RATIO = 9

export type Size = { width: number; height: number }

export type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** 新画布矩形：width/height 为新画布尺寸，x/y 为原图左上角在新画布中的偏移。 */
export type OutpaintRect = { x: number; y: number; width: number; height: number }

/** 一次拖拽位移（原图像素单位，调用方已按 fitScale 换算）。 */
export type DragDelta = { dx: number; dy: number }

type MovingEdges = { west: boolean; east: boolean; north: boolean; south: boolean }

/** 手柄 → 随指针移动的边；未标 true 的边在该手柄拖拽时保持固定。 */
export const HANDLE_MOVING_EDGES: Record<HandleDir, MovingEdges> = {
  nw: { west: true, east: false, north: true, south: false },
  n: { west: false, east: false, north: true, south: false },
  ne: { west: false, east: true, north: true, south: false },
  e: { west: false, east: true, north: false, south: false },
  se: { west: false, east: true, north: false, south: true },
  s: { west: false, east: false, north: false, south: true },
  sw: { west: true, east: false, north: false, south: true },
  w: { west: true, east: false, north: false, south: false },
}

/** 手柄渲染顺序（4 角 + 4 边），模板与测试共用。 */
export const HANDLE_DIRS: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** 初始画布 = 原图本身（无扩出区）：四向扩展量全为 0。 */
export function initialOutpaintRect(base: Size): OutpaintRect {
  return { x: 0, y: 0, width: Math.max(0, base.width), height: Math.max(0, base.height) }
}

/**
 * 是否已产生真实扩出（任一向扩展量 > 0）。
 * 提交守卫用：扩出量全为 0 时蒙版是整片黑，提交只会白扣积分，必须禁用生成按钮。
 */
export function hasOutpaintExtension(base: Size, rect: OutpaintRect): boolean {
  if (!(base.width > 0) || !(base.height > 0)) return false
  return rect.x > 0 || rect.y > 0 || rect.width > base.width || rect.height > base.height
}

/**
 * 落像素：对外（读数 / store / 提交合成）使用的整数矩形。
 * 四值同时向下取整，保证「原图仍完整包含在新画布内」恒成立
 * （floor(width) ≥ floor(x) + base.width）。
 */
export function floorOutpaintRect(rect: OutpaintRect): OutpaintRect {
  return {
    x: Math.floor(rect.x),
    y: Math.floor(rect.y),
    width: Math.floor(rect.width),
    height: Math.floor(rect.height),
  }
}

/**
 * 以 `start` 为基准应用一次拖拽位移，返回 clamp 后的新画布矩形。
 *
 * 组件按 pointermove 逐帧增量调用（每帧以当前 rect 作 start）：手柄始终跟随指针，
 * 且中途不取整，避免逐帧 floor 累积出的漂移。返回值保留小数，落像素走 floorOutpaintRect。
 *
 * `bounds`（可选，2026-09-22 用户验收修订）：新画布尺寸上限（缩放锚定原图后，
 * 视口能容纳的最大画布 px）。拖出视口的手柄无法再被抓取，因此拖拽增量被钳制在
 * bounds 内——只裁「正在移动的边」的扩展量，对边固定语义不破；bounds 不足以容纳
 * 单边下限矩形时该轴忽略 bounds（下限优先）。
 */
export function resizeOutpaintRect(
  base: Size,
  start: OutpaintRect,
  delta: DragDelta,
  dir: HandleDir,
  bounds?: Size,
): OutpaintRect {
  const moving = HANDLE_MOVING_EDGES[dir]
  const maxArea =
    OUTPAINT_MAX_AREA_RATIO * Math.max(0, base.width) * Math.max(0, base.height)

  const next = applyDragStep(base, start, delta, moving, 1)
  const result = next.width * next.height <= maxArea ? next : clampToAreaBudget(base, start, delta, moving, maxArea)
  return bounds ? clampRectToBounds(base, result, bounds, moving) : result
}

/** 面积预算用尽：截断「本次拖拽幅度」到预算边界，而不是回头缩小已经扩出的边。 */
function clampToAreaBudget(
  base: Size,
  start: OutpaintRect,
  delta: DragDelta,
  moving: MovingEdges,
  maxArea: number,
): OutpaintRect {
  // 语义上等于手柄停在预算边界上；反向拖拽可立即回退。
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2
    const probe = applyDragStep(base, start, delta, moving, mid)
    if (probe.width * probe.height <= maxArea) lo = mid
    else hi = mid
  }
  return applyDragStep(base, start, delta, moving, lo)
}

/** 视口钳制：只裁移动边的扩展量，把新画布尺寸压回 bounds；下限矩形放不下时忽略。 */
function clampRectToBounds(base: Size, rect: OutpaintRect, bounds: Size, moving: MovingEdges): OutpaintRect {
  const bw = Math.max(0, base.width)
  const bh = Math.max(0, base.height)
  const minW = Math.max(bw, OUTPAINT_MIN_EDGE)
  const minH = Math.max(bh, OUTPAINT_MIN_EDGE)
  const maxW = Number.isFinite(bounds.width) ? bounds.width : Infinity
  const maxH = Number.isFinite(bounds.height) ? bounds.height : Infinity

  let { x, y, width, height } = rect
  if (maxW >= minW && width > maxW) {
    const overflow = width - maxW
    if (moving.west && x > 0) {
      const trim = Math.min(overflow, x)
      x -= trim
      width -= trim
    }
    if (moving.east && width > maxW) {
      const eastPad = Math.max(0, width - x - bw)
      width -= Math.min(width - maxW, eastPad)
    }
  }
  if (maxH >= minH && height > maxH) {
    const overflow = height - maxH
    if (moving.north && y > 0) {
      const trim = Math.min(overflow, y)
      y -= trim
      height -= trim
    }
    if (moving.south && height > maxH) {
      const southPad = Math.max(0, height - y - bh)
      height -= Math.min(height - maxH, southPad)
    }
  }
  return { x, y, width, height }
}

/** 把位移按系数 t 作用到「移动边」上并 clamp 到合法区间（面积上限由调用方处理）。 */
function applyDragStep(
  base: Size,
  start: OutpaintRect,
  delta: DragDelta,
  moving: MovingEdges,
  t: number,
): OutpaintRect {
  const bw = Math.max(0, base.width)
  const bh = Math.max(0, base.height)

  // 起始四向扩展量（start 恒为合法矩形 → 均 ≥ 0）
  let west = Math.max(0, start.x)
  let east = Math.max(0, start.width - start.x - bw)
  let north = Math.max(0, start.y)
  let south = Math.max(0, start.height - start.y - bh)

  const dx = delta.dx * t
  const dy = delta.dy * t
  // 手柄向外拖 → 该侧扩展量增大；向内拖 → 减小（下方 clamp 到 0，即停在原图边界）
  if (moving.west) west -= dx
  if (moving.east) east += dx
  if (moving.north) north -= dy
  if (moving.south) south += dy

  west = Math.max(0, west)
  east = Math.max(0, east)
  north = Math.max(0, north)
  south = Math.max(0, south)

  // 单边下限：只让「正在移动的边」补齐，固定边不跳动
  const wx = padMinEdge(bw, west, east, moving.west, moving.east, Math.max(bw, OUTPAINT_MIN_EDGE))
  const hy = padMinEdge(
    bh,
    north,
    south,
    moving.north,
    moving.south,
    Math.max(bh, OUTPAINT_MIN_EDGE),
  )

  return {
    x: wx.start,
    y: hy.start,
    width: bw + wx.start + wx.end,
    height: bh + hy.start + hy.end,
  }
}

/** 画布边长不足下限时，把缺口补在正在移动的那一侧（该轴未参与拖拽时原样返回）。 */
function padMinEdge(
  base: number,
  start: number,
  end: number,
  movingStart: boolean,
  movingEnd: boolean,
  min: number,
): { start: number; end: number } {
  const deficit = min - (base + start + end)
  if (deficit <= 0) return { start, end }
  if (movingStart) return { start: start + deficit, end }
  if (movingEnd) return { start, end: end + deficit }
  return { start, end }
}

/** 常见比例（横向 + 纵向），按 2% 容差匹配，命中即返回紧凑标签。 */
const COMMON_ASPECTS: [number, number][] = [
  [1, 1],
  [5, 4],
  [4, 3],
  [3, 2],
  [16, 10],
  [16, 9],
  [2, 1],
  [3, 1],
  [4, 5],
  [3, 4],
  [2, 3],
  [10, 16],
  [9, 16],
  [1, 2],
  [1, 3],
]

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** 读数用比例标签（规格 §3「宽×高·比例」）：优先常见比例，其次最简整数比，最后一位小数。 */
export function formatAspectLabel(width: number, height: number): string {
  if (!(width > 0) || !(height > 0)) return '—'
  const ratio = width / height
  for (const [a, b] of COMMON_ASPECTS) {
    const target = a / b
    if (Math.abs(ratio - target) / target <= 0.02) return `${a}:${b}`
  }
  const g = gcd(width, height)
  const a = width / g
  const b = height / g
  if (a <= 40 && b <= 40) return `${a}:${b}`
  const round1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
  return ratio >= 1 ? `${round1(ratio)}:1` : `1:${round1(1 / ratio)}`
}

/**
 * 比例预设：返回「包含原图、面积最小、比例精确等于 ratio」的新画布矩形。
 *
 * 语义与拖拽不同：**替换**当前 rect，不做累积（§6.2）。ratio 为 null = 原图，
 * 等价 initialOutpaintRect。扩展量在两轴对称均分（x = max(0, w - minW) / 2，
 * minW = max(bw, OUTPAINT_MIN_EDGE)）：原图本身小于单边下限时，下限缺口整块落在
 * 东 / 南侧（x = y = 0），只有超出下限的增量才均分——与逐边模型补缺口的取舍一致。
 * 允许小数，对外落像素由 floorOutpaintRect 负责。
 *
 * 两轴下界 max(base, OUTPAINT_MIN_EDGE) 同时参与解算：先取宽度下界，若算出高度
 * 不足高度下界，则以高度下界反解宽度——保证「该比例 + 包含原图 + 单边 ≥256」三条同时成立。
 *
 * 面积上限（§8）只在「最小包含矩形本身已在上限内」时有收缩空间；若最小包含矩形就超上限，
 * **包含原图是硬不变量**，直接返回该矩形（极端比例原图，如 4000×100 选 9:16）。
 */
export function fitRectToAspect(base: Size, ratio: { w: number; h: number } | null): OutpaintRect {
  const bw = Math.max(0, base.width)
  const bh = Math.max(0, base.height)
  if (!ratio || !(ratio.w > 0) || !(ratio.h > 0) || !(bw > 0) || !(bh > 0)) {
    return initialOutpaintRect(base)
  }
  const target = ratio.w / ratio.h
  const minW = Math.max(bw, OUTPAINT_MIN_EDGE)
  const minH = Math.max(bh, OUTPAINT_MIN_EDGE)

  let width = Math.max(minW, minH * target)
  let height = width / target

  const maxArea = OUTPAINT_MAX_AREA_RATIO * bw * bh
  if (width * height > maxArea) {
    const scale = Math.sqrt(maxArea / (width * height))
    const candW = width * scale
    const candH = height * scale
    // 收缩后仍须包含原图，否则保持最小包含矩形（包含原图优先）
    if (candW >= bw && candH >= bh) {
      width = candW
      height = candH
    }
  }

  // 均分基准取 clamp 后的下界 minW / minH（而非裸 bw / bh）：原图不足单边下限时，
  // 下限缺口整块落在东 / 南侧，只有超出下限的增量才在两轴均分。
  return {
    x: Math.max(0, width - minW) / 2,
    y: Math.max(0, height - minH) / 2,
    width,
    height,
  }
}

/**
 * 画布尺寸数字输入：绝对值语义（不是增量），落像素为整数。
 *
 * clamp：`w ≥ max(baseW, 256)`、`h ≥ max(baseH, 256)`（扩图不裁剪 + 单边下限），
 * 面积超 9 倍时两轴等比收缩（同样不低于上述下界）。扩展量在两轴**对称均分**，
 * 奇数像素差多的 1px 给右侧 / 下方（§6.2）；原图本身小于 256 的那一轴，下限缺口
 * 整块落在右侧 / 下方，不参与均分。
 *
 * 非法输入（NaN / ±Infinity）等价 initialOutpaintRect，绝不把 NaN 写进状态。
 */
export function resizeOutpaintAbsolute(base: Size, width: number, height: number): OutpaintRect {
  const bw = Math.max(0, base.width)
  const bh = Math.max(0, base.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return initialOutpaintRect(base)
  }
  const minW = Math.max(bw, OUTPAINT_MIN_EDGE)
  const minH = Math.max(bh, OUTPAINT_MIN_EDGE)

  let w = Math.max(minW, Math.round(width))
  let h = Math.max(minH, Math.round(height))

  const maxArea = OUTPAINT_MAX_AREA_RATIO * bw * bh
  if (maxArea > 0 && w * h > maxArea) {
    const scale = Math.sqrt(maxArea / (w * h))
    w = Math.max(minW, Math.floor(w * scale))
    h = Math.max(minH, Math.floor(h * scale))
  }

  const west = Math.floor(Math.max(0, w - minW) / 2)
  const north = Math.floor(Math.max(0, h - minH) / 2)
  return { x: west, y: north, width: w, height: h }
}

/**
 * 四向扩展量（读数用，只读）。调用方传 `floorOutpaintRect` 之后的矩形，
 * 使读数与提交几何一致。四值恒 ≥ 0（扩图不裁剪，负向一律夹到 0）。
 */
export function outpaintExtensionAmounts(
  base: Size,
  rect: OutpaintRect,
): { west: number; east: number; north: number; south: number } {
  const bw = Math.max(0, base.width)
  const bh = Math.max(0, base.height)
  return {
    west: Math.max(0, Math.round(rect.x)),
    east: Math.max(0, Math.round(rect.width - rect.x - bw)),
    north: Math.max(0, Math.round(rect.y)),
    south: Math.max(0, Math.round(rect.height - rect.y - bh)),
  }
}
