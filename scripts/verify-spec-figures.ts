#!/usr/bin/env tsx
/**
 * 规格配图校验器 —— docs/superpowers/SPEC-CONVENTIONS.md 的可执行部分。
 *
 * 规则（R1–R8）：
 *   R1 视觉稿必须是 assets/ 下的 .svg（禁止 png/jpg/gif，禁止绝对路径/外链）
 *   R2 图号唯一且从 1 连续
 *   R3 每张图必须有图注（图注在图的上一行或下一行）
 *   R4 每张图应在正文被引用（警告）
 *   R5 含图的文档必须有 §0 配图索引，且索引列出全部图号
 *   R6 附件必须存在（相对路径）
 *   R7 Mermaid 块非空且首行为受支持图类型
 *   R8 视觉稿应有标注/图例（SVG 内 text 少于 3 个 → 警告）
 *
 * 用法：
 *   pnpm verify-spec-figures                # 只校验生效日（含）之后的新文档
 *   pnpm verify-spec-figures --all          # 全量校验（含历史文档，用于批量补图时扫底）
 *   pnpm verify-spec-figures --file docs/superpowers/specs/xxx.md
 *
 * 生效范围：规范自 2026-09-22 起适用于新增文档；生效日之前的历史文档不追溯
 * （下次实质修改该文档时须补齐，见 SPEC-CONVENTIONS §8）。
 *
 * 豁免：文档内出现 `spec-figures: off` 即跳过（应附理由）。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const SCAN_DIRS = ['docs/superpowers/specs', 'docs/superpowers/plans']
/** 规范生效日：此前创建的文档不追溯校验 */
const EFFECTIVE_DATE = '2026-09-22'
const MERMAID_TYPES = [
  'flowchart', 'graph', 'stateDiagram-v2', 'stateDiagram', 'sequenceDiagram',
  'erDiagram', 'classDiagram', 'journey', 'gantt', 'pie', 'mindmap', 'timeline',
  'quadrantChart', 'gitGraph',
]
const ALLOWED_IMAGE_EXT = ['.svg']

type Level = 'error' | 'warn'
interface Finding { level: Level; rule: string; line?: number; message: string }

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'assets' || entry === 'node_modules') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (entry.endsWith('.md')) out.push(full)
  }
  return out
}

const CAPTION_RE = /^\*{1,2}\s*图\s*(\d+)\s*[·:：.、]/
const INDEX_HEADING_RE = /^#{2,3}\s*0[.、]?\s*配图索引/
const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g

function nonEmpty(lines: string[], from: number, step: 1 | -1): { line: number; text: string } | null {
  for (let i = from; i >= 0 && i < lines.length; i += step) {
    const t = lines[i]!.trim()
    if (t) return { line: i + 1, text: t }
  }
  return null
}

/** 轻量解析 SVG：返回 text 元素数与越界元素数 */
function inspectSvg(path: string): { texts: number; overflow: string[] } {
  const src = readFileSync(path, 'utf8')
  const texts = (src.match(/<text\b/g) ?? []).length
  const m = /viewBox="([^"]+)"/.exec(src)
  const overflow: string[] = []
  if (!m) return { texts, overflow: ['缺少 viewBox'] }
  const [minX, minY, w, h] = m[1]!.trim().split(/[\s,]+/).map(Number) as number[]
  const maxX = (minX ?? 0) + (w ?? 0)
  const maxY = (minY ?? 0) + (h ?? 0)
  const num = (attrs: string, key: string, dflt = 0): number => {
    const r = new RegExp(`${key}="([-\\d.]+)"`).exec(attrs)
    return r ? Number(r[1]) : dflt
  }
  for (const tag of src.match(/<rect\b[^>]*>/g) ?? []) {
    const x = num(tag, 'x'), y = num(tag, 'y'), rw = num(tag, 'width'), rh = num(tag, 'height')
    if (x < minX! - 0.5 || y < minY! - 0.5 || x + rw > maxX + 0.5 || y + rh > maxY + 0.5) {
      overflow.push(`rect(${x},${y},${rw}×${rh})`)
    }
  }
  for (const tag of src.match(/<circle\b[^>]*>/g) ?? []) {
    const cx = num(tag, 'cx'), cy = num(tag, 'cy'), r = num(tag, 'r')
    if (cx - r < minX! - 0.5 || cy - r < minY! - 0.5 || cx + r > maxX + 0.5 || cy + r > maxY + 0.5) {
      overflow.push(`circle(${cx},${cy},r${r})`)
    }
  }
  if (maxX > 4000 || maxY > 4000) overflow.push(`viewBox 异常大：${maxX}×${maxY}`)
  return { texts, overflow }
}

function checkFile(file: string): Finding[] {
  const findings: Finding[] = []
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const rel = file.replace(`${ROOT}/`, '')

  if (/spec-figures:\s*off/.test(text)) {
    console.log(`○ 跳过（豁免）：${rel}`)
    return findings
  }

  interface Figure { no: number | null; kind: 'mermaid' | 'image'; line: number; captionLine: number | null; anchor: string }
  const figures: Figure[] = []
  /** 已被认领的图注行号（1-based）：防止相邻两张图抢同一句图注 */
  const claimedCaptions = new Set<number>()

  /** 认领图注：接受紧邻（可跨空行）的下一行或上一行，且未被别的图占用 */
  const claimCaption = (curLine1: number, endLine1: number): { line: number; text: string } | null => {
    const after = nonEmpty(lines, endLine1, 1)
    if (after && !claimedCaptions.has(after.line) && CAPTION_RE.test(after.text)) {
      claimedCaptions.add(after.line)
      return after
    }
    const before = nonEmpty(lines, curLine1 - 2, -1)
    if (before && !claimedCaptions.has(before.line) && CAPTION_RE.test(before.text)) {
      claimedCaptions.add(before.line)
      return before
    }
    return null
  }

  // ---- 按文档顺序单次遍历：Mermaid 块与图片引用统一编号，避免抢图注 ----
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!

    if (raw.trim() === '```mermaid') {
      let end = -1
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j]!.trim().startsWith('```')) { end = j; break }
      }
      if (end === -1) {
        findings.push({ level: 'error', rule: 'R7', line: i + 1, message: 'Mermaid 代码块未闭合' })
        continue
      }
      const body = lines.slice(i + 1, end).filter((l) => l.trim())
      if (body.length === 0) {
        findings.push({ level: 'error', rule: 'R7', line: i + 1, message: 'Mermaid 代码块为空' })
      } else if (!MERMAID_TYPES.some((t) => body[0]!.trim().startsWith(t))) {
        findings.push({
          level: 'error', rule: 'R7', line: i + 2,
          message: `Mermaid 首行不是受支持的图类型：${body[0]!.trim().slice(0, 40)}`,
        })
      }
      const cap = claimCaption(i + 1, end + 1)
      figures.push({
        no: cap ? Number(CAPTION_RE.exec(cap.text)![1]) : null,
        kind: 'mermaid', line: i + 1, captionLine: cap?.line ?? null, anchor: `mermaid@${i + 1}`,
      })
      i = end
      continue
    }

    IMAGE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = IMAGE_RE.exec(raw)) !== null) {
      const src = m[1]!
      const cap = claimCaption(i + 1, i + 1)
      figures.push({
        no: cap ? Number(CAPTION_RE.exec(cap.text)![1]) : null,
        kind: 'image', line: i + 1, captionLine: cap?.line ?? null, anchor: src,
      })

      if (/^https?:\/\//.test(src)) {
        findings.push({ level: 'warn', rule: 'R1', line: i + 1, message: `外链图片（规格资产应入库）：${src}` })
        continue
      }
      if (src.startsWith('/')) {
        findings.push({ level: 'error', rule: 'R6', line: i + 1, message: `必须用相对路径引用：${src}` })
      }
      const ext = extname(src).toLowerCase()
      if (!ALLOWED_IMAGE_EXT.includes(ext)) {
        findings.push({ level: 'error', rule: 'R1', line: i + 1, message: `视觉稿必须是 SVG（当前 ${ext || '无扩展名'}）：${src}` })
      }
      if (!src.includes('assets/')) {
        findings.push({ level: 'error', rule: 'R1', line: i + 1, message: `视觉稿必须放在本文档同目录的 assets/ 下：${src}` })
      }
      const abs = resolve(dirname(file), src)
      if (!existsSync(abs)) {
        findings.push({ level: 'error', rule: 'R6', line: i + 1, message: `附件不存在：${src}` })
      } else if (ext === '.svg') {
        const info = inspectSvg(abs)
        if (info.overflow.length) {
          findings.push({
            level: 'error', rule: 'R1', line: i + 1,
            message: `SVG 元素越界（${info.overflow.length} 处）：${info.overflow.slice(0, 3).join(', ')} — ${src}`,
          })
        }
        if (info.texts < 3) {
          findings.push({ level: 'warn', rule: 'R8', line: i + 1, message: `视觉稿疑似缺少标注/图例（text 元素 ${info.texts} 个）：${src}` })
        }
      }
    }
  }

  // ---- 图注缺失 ----
  for (const f of figures) {
    if (f.no === null) {
      findings.push({
        level: 'error', rule: 'R3', line: f.line,
        message: `缺少图注（应在图的上一行或下一行写「图 N · 说明」）：${f.anchor}`,
      })
    }
  }

  // ---- 图号连续唯一 ----
  const nos = figures.map((f) => f.no).filter((n): n is number => n !== null)
  const sorted = [...new Set(nos)].sort((a, b) => a - b)
  if (sorted.length !== nos.length) {
    findings.push({ level: 'error', rule: 'R2', line: 0, message: `图号重复：${nos.join(', ')}` })
  }
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      findings.push({ level: 'error', rule: 'R2', line: 0, message: `图号不连续：期望 图 ${i + 1}，实际 图 ${sorted[i]}（现有 ${sorted.join(', ')}）` })
      break
    }
  }

  // ---- §0 配图索引 ----
  if (figures.length > 0) {
    let idxStart = -1
    let idxEnd = lines.length
    for (let i = 0; i < lines.length; i++) {
      if (INDEX_HEADING_RE.test(lines[i]!.trim())) { idxStart = i; break }
    }
    if (idxStart === -1) {
      findings.push({ level: 'error', rule: 'R5', line: 1, message: '含图文档缺少 §0 配图索引章节（见 SPEC-CONVENTIONS §5）' })
    } else {
      for (let j = idxStart + 1; j < lines.length; j++) {
        if (/^#{2,3}\s/.test(lines[j]!.trim())) { idxEnd = j; break }
      }
      const idxBody = lines.slice(idxStart, idxEnd).join('\n')
      for (const n of sorted) {
        if (!new RegExp(`图\\s*${n}\\b`).test(idxBody)) {
          findings.push({ level: 'error', rule: 'R5', line: idxStart + 1, message: `§0 配图索引未列出 图 ${n}` })
        }
      }
      // R4：正文引用（排除索引区与图注行）
      const captionLines = new Set(figures.map((f) => f.captionLine).filter(Boolean) as number[])
      const bodyLines = lines.filter((_, i) => (i < idxStart || i >= idxEnd) && !captionLines.has(i + 1))
      const body = bodyLines.join('\n')
      for (const n of sorted) {
        if (!new RegExp(`图\\s*${n}\\b`).test(body)) {
          findings.push({ level: 'warn', rule: 'R4', line: 0, message: `正文未引用 图 ${n}（建议在判据/验收处引用）` })
        }
      }
    }
  }

  return findings
}

function main() {
  const args = process.argv.slice(2)
  const argFileIdx = args.indexOf('--file')
  const checkAll = args.includes('--all')
  const files = argFileIdx !== -1
    ? [resolve(args[argFileIdx + 1] ?? '')]
    : SCAN_DIRS.flatMap((d) => walk(resolve(ROOT, d)))

  if (files.length === 0) {
    console.log('未找到待校验的规格文档')
    return
  }

  // 生效范围：文件名日期 < 生效日的历史文档不追溯（--all 或 --file 显式指定时不跳过）
  const inScope: string[] = []
  let skipped = 0
  for (const f of files) {
    const explicit = checkAll || argFileIdx !== -1
    const dateMatch = /(\d{4}-\d{2}-\d{2})/.exec(f)
    const dated = dateMatch ? dateMatch[1]! : null
    if (!explicit && dated !== null && dated < EFFECTIVE_DATE) { skipped++; continue }
    inScope.push(f)
  }

  let errors = 0
  let warns = 0

  for (const file of inScope) {
    const findings = checkFile(file)
    const rel = file.replace(`${ROOT}/`, '')
    const errs = findings.filter((f) => f.level === 'error')
    const ws = findings.filter((f) => f.level === 'warn')
    errors += errs.length
    warns += ws.length
    if (errs.length === 0 && ws.length === 0) {
      console.log(`✓ ${rel}`)
    } else {
      console.log(`${errs.length ? '✗' : '!'} ${rel}`)
      for (const f of [...errs, ...ws]) {
        const at = f.line ? `:${f.line}` : ''
        console.log(`    ${f.level === 'error' ? 'error' : 'warn '} [${f.rule}]${at} ${f.message}`)
      }
    }
  }

  console.log('')
  console.log(`校验完成：${inScope.length} 篇在范围内，${skipped} 篇历史文档跳过（< ${EFFECTIVE_DATE}），${errors} 个错误，${warns} 个警告`)
  if (skipped > 0) {
    console.log(`历史文档可用 pnpm verify-spec-figures --all 全量扫底；实质修改旧文档时须补齐配图规范。`)
  }
  if (errors > 0) {
    console.log('规范见 docs/superpowers/SPEC-CONVENTIONS.md')
    process.exit(1)
  }
}

main()
