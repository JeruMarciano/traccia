import { STRINGS } from './strings'

/**
 * Which of the two save notices to show for a failed save.
 *
 * The main process throws one of exactly two fixed sentences, and Electron wraps whichever it was
 * in its own "Error invoking remote method ..." text on the way across. So the rejection is
 * searched for the one actionable sentence, and the renderer then shows its own copy of that
 * sentence. The text that arrived is never displayed, so nothing Electron or Node put into it can
 * reach the screen.
 */
export function saveNotice(error: unknown): string {
  const received = error instanceof Error ? error.message : ''
  return received.includes(STRINGS.saveBlocked) ? STRINGS.saveBlocked : STRINGS.saveFailed
}
