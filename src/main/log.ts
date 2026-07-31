import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_MESSAGE = 200

/**
 * Appends one line to a local log the user can find and choose to share.
 * Nothing is ever uploaded. Messages are truncated so a stack trace cannot
 * carry project content into the file.
 */
export async function writeCrashLine(dir: string, line: string): Promise<void> {
  const stamp = new Date().toISOString()
  const safe = line.slice(0, MAX_MESSAGE)
  await appendFile(join(dir, 'traccia.log'), `${stamp} ${safe}\n`, 'utf8')
}
