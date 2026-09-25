import sharp from 'sharp'

/** 对象边界框（原图像素坐标）。 */
export interface ElementBBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 从分割蒙版 PNG 计算对象边界框。蒙版与原图尺寸不一致时先对齐到原图尺寸。
 * 判定：alpha > 127 或亮度 > 127（SAM 蒙版为白对象/黑底，某些输出带 alpha）。
 * 返回 null = 蒙版为空（未识别到对象）。
 */
export async function computeMaskBBox(
  maskPng: Buffer,
  imgWidth: number,
  imgHeight: number,
): Promise<ElementBBox | null> {
  let pipeline = sharp(maskPng)
  const meta = await pipeline.metadata()
  if (!meta.width || !meta.height) return null
  if (meta.width !== imgWidth || meta.height !== imgHeight) {
    pipeline = sharp(maskPng).resize(imgWidth, imgHeight, { fit: 'fill' })
  }
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = info.width * info.height
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let i = 0; i < px; i += 1) {
    const a = data[i * 4 + 3]!
    const r = data[i * 4]!
    const g = data[i * 4 + 1]!
    const b = data[i * 4 + 2]!
    const hit = a > 127 || 0.299 * r + 0.587 * g + 0.114 * b > 127
    if (!hit) continue
    const x = i % info.width
    const y = Math.floor(i / info.width)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** 蒙版对齐到原图尺寸并回写 PNG（元素编辑累积蒙版 / 产物落盘用）。 */
export async function normalizeMaskPng(
  maskPng: Buffer,
  imgWidth: number,
  imgHeight: number,
): Promise<Buffer> {
  const meta = await sharp(maskPng).metadata()
  if (meta.width === imgWidth && meta.height === imgHeight) return maskPng
  return sharp(maskPng).resize(imgWidth, imgHeight, { fit: 'fill' }).png().toBuffer()
}

/**
 * 原图按 bbox（外扩 10% 边距）裁剪 → JPEG dataURL，供识图模型命名。
 * bbox 越界自动钳制；极端小目标保证 ≥ 32px 采样。
 */
export async function cropImageToDataUrl(
  imageBuf: Buffer,
  bbox: ElementBBox,
): Promise<string> {
  const meta = await sharp(imageBuf).metadata()
  const W = meta.width ?? bbox.x + bbox.width
  const H = meta.height ?? bbox.y + bbox.height
  const mx = Math.round(bbox.width * 0.1)
  const my = Math.round(bbox.height * 0.1)
  const left = Math.max(0, bbox.x - mx)
  const top = Math.max(0, bbox.y - my)
  const width = Math.min(W - left, bbox.width + mx * 2)
  const height = Math.min(H - top, bbox.height + my * 2)
  const jpeg = await sharp(imageBuf)
    .extract({ left, top, width, height })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

/** 从识图模型输出提取对象名：容错 markdown 代码块 / 前后杂讯；取 name 字段，截 12 字符。 */
export function parseElementName(text: string): string | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    const parsed = JSON.parse(trimmed) as { name?: unknown }
    if (typeof parsed.name === 'string' && parsed.name.trim()) {
      return parsed.name.trim().slice(0, 12)
    }
  } catch {
    /* fall through to regex */
  }
  const m = trimmed.match(/"name"\s*:\s*"([^"]{1,24})"/)
  if (m?.[1]?.trim()) return m[1].trim().slice(0, 12)
  return null
}
