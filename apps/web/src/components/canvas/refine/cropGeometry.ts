import type { HandleDir } from './outpaintGeometry'

/**
 * 裁剪几何（纯函数，浏览器无关，可 jsdom 直测）。
 *
 * 坐标模型（与 cropExport.ts 渲染同源）：
 *  - 原图 W×H 绕中心旋转 θ 后的**包围盒** W'×H'（rotatedSize）；
 *  - 裁剪框 rect 是包围盒坐标系里**始终直立**的矩形（x/y 为包围盒左上角原点）；
 *  - 合法性判据：裁剪框四角全部落在旋转后的原图内（半平面约束），导出无透明楔角。
 */

export type CropRect = { x: number; y: number; width: number; height: number }

/** 比例预设 id：free 不锁比例，其余锁定 w:h。 */
export type CropAspectId = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16'

export const CROP_ASPECT_RATIOS: Record<Exclude<CropAspectId, 'free'>, { w: number; h: number }> = {
  '1:1': { w: 1, h: 1 },
  '4:3': { w: 4, h: 3 },
  '3:4': { w: 3, h: 4 },
  '16:9': { w: 16, h: 9 },
  '9:16': { w: 9, h: 16 },
}

/** 裁剪框单边下限（原图像素）。 */
export const CROP_MIN_SIZE = 24

/** 自由旋转微调角范围（°）：90° 步进之外的手感区间（iOS「校正」同款）。 */
export const CROP_FINE_MIN = -45
export const CROP_FINE_MAX = 45

/** 归一化到 (-180, 180]。 */
export function normalizeCropRotation(deg: number): number {
  let d = deg % 360
  if (d <= -180) d += 360
  else if (d > 180) d -= 360
  return d === 0 ? 0 : d // 消除 -0（esbuild 严格相等告警）
}

/** 总旋转角：90° 步进（turns，可负）+ 微调（fine，−45..45）。 */
export function totalCropRotationDeg(turns: number, fine: number): number {
  return normalizeCropRotation(turns * 90 + clampFineRotation(fine))
}

export function clampFineRotation(fine: number): number {
  if (!Number.isFinite(fine)) return 0
  return Math.min(CROP_FINE_MAX, Math.max(CROP_FINE_MIN, fine))
}

/** 旋转后包围盒 W'×H'。 */
export function rotatedSize(width: number, height: number, thetaDeg: number): { width: number; height: number } {
  const t = (thetaDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(t))
  const s = Math.abs(Math.sin(t))
  return {
    width: width * c + height * s,
    height: width * s + height * c,
  }
}

/**
 * 旋转原图内**面积最大**的直立内接矩形（居中）。经典闭式解：
 * 短边 ≤ 2·sinA·cosA·长边（含 45°）时退化为菱形内接，否则用 cos2a 公式。
 * θ=0 → 全图；θ=90° → 原图转置。
 */
export function largestUprightRect(width: number, height: number, thetaDeg: number): CropRect {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0, width: 0, height: 0 }
  const t = (thetaDeg * Math.PI) / 180
  const sinA = Math.abs(Math.sin(t))
  const cosA = Math.abs(Math.cos(t))
  const widthIsLonger = width >= height
  const sideLong = widthIsLonger ? width : height
  const sideShort = widthIsLonger ? height : width
  let wr: number
  let hr: number
  if (sideShort <= 2 * sinA * cosA * sideLong || Math.abs(sinA - cosA) < 1e-10) {
    // 旋转过大：最大内接矩形受短边支配（x = 短边一半）
    const x = 0.5 * sideShort
    wr = widthIsLonger ? x / sinA : x / cosA
    hr = widthIsLonger ? x / cosA : x / sinA
  } else {
    const cos2a = cosA * cosA - sinA * sinA
    wr = (width * cosA - height * sinA) / cos2a
    hr = (height * cosA - width * sinA) / cos2a
  }
  const bw = width * cosA + height * sinA
  const bh = width * sinA + height * cosA
  return {
    x: (bw - wr) / 2,
    y: (bh - hr) / 2,
    width: wr,
    height: hr,
  }
}

/**
 * 进入裁剪 / 换比例 / 换角度时的**适配**：先取最大内接直立矩形，
 * 再把比例（非 free）居中装进去。
 */
export function fitCropRect(
  imgWidth: number,
  imgHeight: number,
  thetaDeg: number,
  aspect: CropAspectId,
): CropRect {
  const inscribed = largestUprightRect(imgWidth, imgHeight, thetaDeg)
  if (aspect === 'free') return inscribed
  const ratio = CROP_ASPECT_RATIOS[aspect]
  const ratioValue = ratio.w / ratio.h
  // 内接矩形里装下最大比例矩形：按短约束缩放
  let w = inscribed.width
  let h = w / ratioValue
  if (h > inscribed.height) {
    h = inscribed.height
    w = h * ratioValue
  }
  return {
    x: inscribed.x + (inscribed.width - w) / 2,
    y: inscribed.y + (inscribed.height - h) / 2,
    width: w,
    height: h,
  }
}

/**
 * 裁剪框合法性钳制（精确解，纯线性约束）：
 *  1) 尺寸不可行（某方向半宽越界）→ 等比缩小到恰好可行；
 *  2) 中心钳到「旋转坐标系下的可行带」（|u| ≤ A、|v| ≤ B），再变换回包围盒坐标；
 *  3) 最后钳进包围盒 [0, W']×[0, H']。
 */
export function clampCropRect(
  rect: CropRect,
  imgWidth: number,
  imgHeight: number,
  thetaDeg: number,
): CropRect {
  if (!(imgWidth > 0) || !(imgHeight > 0)) return rect
  const t = (thetaDeg * Math.PI) / 180
  const c = Math.abs(Math.cos(t))
  const s = Math.abs(Math.sin(t))
  const bw = imgWidth * c + imgHeight * s
  const bh = imgWidth * s + imgHeight * c

  let width = Math.max(CROP_MIN_SIZE, rect.width)
  let height = Math.max(CROP_MIN_SIZE, rect.height)

  // 1) 尺寸可行性：半宽在两根原图轴上的投影必须 ≤ 原图半轴
  const halfW = (width / 2) * c + (height / 2) * s
  const halfH = (width / 2) * s + (height / 2) * c
  const k = Math.min(1, imgWidth / 2 / halfW, imgHeight / 2 / halfH)
  if (k < 1) {
    width *= k
    height *= k
  }

  // 2) 中心钳制：旋转坐标系 (u, v) 各自落在 [-A, A] / [-B, B]
  //    约束轴是**原图**两根轴（|p·u| ≤ imgWidth/2、|p·v| ≤ imgHeight/2），不是包围盒。
  const a = width / 2
  const b = height / 2
  const marginU = imgWidth / 2 - (a * c + b * s) // ≥ 0（第 1 步保证）
  const marginV = imgHeight / 2 - (a * s + b * c)
  const cx = rect.x + width / 2 - bw / 2
  const cy = rect.y + height / 2 - bh / 2
  let u = cx * c + cy * s
  let v = -cx * s + cy * c
  u = Math.min(marginU, Math.max(-marginU, u))
  v = Math.min(marginV, Math.max(-marginV, v))
  const ncx = u * c - v * s
  const ncy = u * s + v * c

  const x = ncx + bw / 2 - width / 2
  const y = ncy + bh / 2 - height / 2

  // 3) 包围盒兜底（θ=0 时 2) 已足够，这里护住浮点毛边）
  const fx = Math.min(bw - width, Math.max(0, x))
  const fy = Math.min(bh - height, Math.max(0, y))
  return { x: fx, y: fy, width, height }
}

/** 平移裁剪框（dx/dy 为包围盒坐标系的原图像素增量），钳制后返回。 */
export function moveCropRect(
  rect: CropRect,
  dx: number,
  dy: number,
  imgWidth: number,
  imgHeight: number,
  thetaDeg: number,
): CropRect {
  return clampCropRect(
    { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height },
    imgWidth,
    imgHeight,
    thetaDeg,
  )
}

/**
 * 8 手柄拖拽调整：dir 决定动哪条边/角；比例锁定（aspect ≠ free）时以拖拽主轴为驱动；
 * 单边下限 CROP_MIN_SIZE；结果钳制到旋转原图内。
 */
export function resizeCropRect(
  rect: CropRect,
  dir: HandleDir,
  dx: number,
  dy: number,
  imgWidth: number,
  imgHeight: number,
  thetaDeg: number,
  aspect: CropAspectId = 'free',
): CropRect {
  let { x, y, width, height } = rect
  const moveLeft = dir.includes('w')
  const moveRight = dir.includes('e')
  const moveTop = dir.includes('n')
  const moveBottom = dir.includes('s')

  let nx = x
  let ny = y
  let nw = width
  let nh = height

  if (moveLeft) {
    const left = Math.min(x + dx, x + width - CROP_MIN_SIZE)
    nx = left
    nw = width + (x - left)
  }
  if (moveRight) {
    nw = Math.max(CROP_MIN_SIZE, width + dx)
  }
  if (moveTop) {
    const top = Math.min(y + dy, y + height - CROP_MIN_SIZE)
    ny = top
    nh = height + (y - top)
  }
  if (moveBottom) {
    nh = Math.max(CROP_MIN_SIZE, height + dy)
  }

  // 比例锁定：以拖拽主轴为驱动重算另一维（角手柄以宽为驱动，n/s 以高为驱动）。
  // 边中点手柄（n/s/w/e 单字符）恒定只动对应一条边，不联动另一轴（与节点直裁同语义）。
  const isEdgeHandle = dir.length === 1
  if (aspect !== 'free' && !isEdgeHandle) {
    const ratio = CROP_ASPECT_RATIOS[aspect].w / CROP_ASPECT_RATIOS[aspect].h
    if (moveTop || moveBottom) {
      nw = Math.max(CROP_MIN_SIZE, nh * ratio)
      if (moveLeft) nx = x + width - nw
    } else {
      nh = Math.max(CROP_MIN_SIZE, nw / ratio)
      if (moveTop) ny = y + height - nh
    }
  }

  // 左/上手柄拖动时左上角不得越过右下角（保持宽高 ≥ MIN 已由上面 min 保证）
  return clampCropRect({ x: nx, y: ny, width: nw, height: nh }, imgWidth, imgHeight, thetaDeg)
}

/** 读数标签：整数 px（向上取整避免「24.0000001」式读数）。 */
export function formatCropReadout(rect: CropRect): string {
  return `${Math.round(rect.width)} × ${Math.round(rect.height)}`
}
