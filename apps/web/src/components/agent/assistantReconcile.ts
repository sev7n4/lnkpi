/** Pure helpers for post-stream assistant message reconcile. */

export const CONFIRM_GATE_SNIPPET = '请确认是否按此方案拆解画布并出图'
export const EXEC_TIP_SNIPPET = '正在按方案拆解'
export const BUSY_TIP_SNIPPET = '上一轮仍在处理中'
export const COPY_DRAFT_SNIPPET = '【主文案草稿】'
export const COPY_WRITTEN_SNIPPET = '已将确认的主文案'

/**
 * Whether DB assistant text should replace the local streaming bubble.
 * Avoids a race: confirm-turn stream dies early while Nest still runs;
 * last DB row may still be the previous confirm-gate message (longer),
 * which would wipe the in-progress tip and re-show confirm chips.
 */
export function shouldApplyReconciledAssistant(localContent: string, dbContent: string): boolean {
  const local = localContent.trim()
  const db = dbContent.trim()
  if (!db) return false
  if (!local) return true

  // Prefer a successful write from DB even if shorter than a stale draft bubble
  if (db.includes(COPY_WRITTEN_SNIPPET) && !local.includes(COPY_WRITTEN_SNIPPET)) {
    return true
  }
  // Never let a previous-turn draft/progress overwrite busy tip or write success
  if (local.includes(BUSY_TIP_SNIPPET)) {
    if (db.includes(COPY_DRAFT_SNIPPET) || db.includes(EXEC_TIP_SNIPPET) || db.includes(BUSY_TIP_SNIPPET)) {
      return false
    }
  }
  if (local.includes(COPY_WRITTEN_SNIPPET) && db.includes(COPY_DRAFT_SNIPPET)) {
    return false
  }

  if (db.length <= local.length) return false
  const localIsExec = local.includes(EXEC_TIP_SNIPPET) || local.includes('已按方案拆解')
  const dbIsStaleGate = db.includes(CONFIRM_GATE_SNIPPET) && !db.includes(EXEC_TIP_SNIPPET)
  if (localIsExec && dbIsStaleGate) return false
  return true
}

export function looksLikeCopyWriteTurn(userText: string): boolean {
  const t = userText.trim()
  if (!t) return false
  return /写入主文案|确认写入|可以写入/.test(t)
}

export function looksLikeConfirmTurn(userText: string): boolean {
  const t = userText.trim()
  if (!t) return false
  if (looksLikeCopyWriteTurn(t)) return true
  if (/^(确认|同意|可以|没问题|开始拆|出图|ok|okay|yes|confirm)\s*$/i.test(t)) return true
  // Long briefs that merely mention「确认」are planning turns, not confirm chips
  if (/请为|写一份|帮我设计|帮我做|帮我写/.test(t)) return false
  return t.length <= 16 && t.includes('确认')
}
