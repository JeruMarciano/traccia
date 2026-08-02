import { invoke } from '@tauri-apps/api/core'
import { validateProject } from '../core/project'
import type { ObservedHost, Project, ScanResult } from '../core/types'
import { STRINGS } from './strings'

/**
 * The only file in the renderer that knows which shell it is running in. Under Electron this was
 * `src/preload/index.ts` and the surface was `window.traccia`; the shape is kept deliberately, so
 * a third shell would touch this file and nothing else.
 *
 * Rust checks what protects the machine — the bytes parse, the top level is an object, there is
 * an integer schemaVersion, the payload is under the size cap. `validateProject` here checks what
 * protects the map, and stays the single source of truth for its shape. No filesystem path
 * crosses this boundary in either direction: the dialogs are opened by Rust.
 */
export async function openProject(): Promise<Project | null> {
  const raw = await invoke<string | null>('open_project')
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(STRINGS.openFailed)
  }

  const result = validateProject(parsed)
  if (!result.ok) throw new Error(STRINGS.openFailed)
  return result.project
}

export async function saveProject(project: Project): Promise<boolean> {
  const result = validateProject(project)
  if (!result.ok) throw new Error(STRINGS.saveFailed)
  // Two-space indentation, as the Electron main process wrote it, so a project file saved before
  // and after the port diffs cleanly. Rust writes these bytes verbatim once its structural check
  // passes.
  return invoke<boolean>('save_project', { projectJson: JSON.stringify(result.project, null, 2) })
}

function isObservedHost(v: unknown): v is ObservedHost {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).host === 'string' &&
    typeof (v as Record<string, unknown>).requestCount === 'number'
  )
}

/**
 * A narrow structural check on what `start_scan` returns. Rust's `ScanOutput` checks what
 * protects the machine (the bytes parse, the shape serialises); this checks what protects the
 * map, the same division `openProject` documents above — including `possibleGaps` and
 * `stoppedEarly`, which a payload missing either must not be allowed to fake its way past.
 */
function isScanResult(v: unknown): v is ScanResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.scannedHost === 'string' &&
    Array.isArray(r.hosts) &&
    r.hosts.every(isObservedHost) &&
    typeof r.pagesVisited === 'number' &&
    typeof r.possibleGaps === 'number' &&
    typeof r.stoppedEarly === 'boolean'
  )
}

export async function startScan(url: string): Promise<ScanResult> {
  const raw = await invoke<string>('start_scan', { url })
  const parsed: unknown = JSON.parse(raw)
  if (!isScanResult(parsed)) throw new Error(STRINGS.scanFailed)
  return parsed
}

export async function cancelScan(): Promise<void> {
  await invoke<void>('cancel_scan')
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error
  return error instanceof Error ? error.message : ''
}

/**
 * Which of the fixed scan sentences to show. Rust throws one of four bare tokens, never a
 * sentence — `src/renderer/strings.ts` owns the copy, per the module comment in
 * `src-tauri/src/scan.rs`. `SCAN_NO_BROWSER` is matched by prefix because it is the one token
 * that carries a payload, the paths that were searched; the text that arrived is only ever
 * matched against, never shown.
 */
export function scanNotice(error: unknown): string {
  const message = messageOf(error)
  if (message.startsWith('SCAN_NO_BROWSER')) return STRINGS.scanNoBrowser
  if (message === 'SCAN_BAD_URL') return STRINGS.scanBadUrl
  if (message === 'SCAN_BUSY') return STRINGS.scanBusy
  return STRINGS.scanFailed
}
