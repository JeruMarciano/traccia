import { STRINGS } from './strings'

/**
 * Which of the two save notices to show for a failed save.
 *
 * Rust throws one of exactly two fixed sentences. Tauri delivers a rejected command as a plain
 * string; a rejection raised inside `bridge.ts` arrives as an Error. Both shapes are read, the
 * text is searched for the one actionable sentence, and the renderer then shows its own copy of
 * that sentence. The text that arrived is never displayed, so nothing the shell or the operating
 * system put into it can reach the screen.
 */
function messageOf(error: unknown): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : ''
}

export function saveNotice(error: unknown): string {
  return messageOf(error).includes(STRINGS.saveBlocked) ? STRINGS.saveBlocked : STRINGS.saveFailed
}
