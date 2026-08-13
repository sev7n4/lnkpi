/** Strip machine-only resume payloads before persisting agent messages. */

const MACHINE_PAYLOAD_PREFIXES = [
  '__scheme_decision__',
  '__macro_scheme_decision__',
  '__delivery_decision__',
] as const

export function filterUserVisibleText(content: string): string {
  return content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart().replace(/^["']+|["']+$/g, '')
      return !MACHINE_PAYLOAD_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
    })
    .join('\n')
    .trim()
}

export function isMachineOnlyVisibleText(content: string): boolean {
  return !filterUserVisibleText(content).trim()
}

export function sanitizeAgentMessageContent(
  role: string,
  content: string,
): string | null {
  const trimmed = (content ?? '').trim()
  if (!trimmed) return null
  if (role === 'user' && isMachineOnlyVisibleText(trimmed)) {
    return null
  }
  if (role === 'user') {
    const visible = filterUserVisibleText(trimmed)
    return visible.trim() || null
  }
  return trimmed
}
