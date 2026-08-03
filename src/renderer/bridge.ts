import { invoke } from '@tauri-apps/api/core'
import { validateProject } from '../core/project'
import type { DocumentText, ObservedHost, Project, ScanResult } from '../core/types'
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

function isRawScanCookie(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    typeof c.name === 'string' &&
    typeof c.domain === 'string' &&
    typeof c.session === 'boolean' &&
    typeof c.expiresEpochSeconds === 'number'
  )
}

function isRawFormField(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  return (
    typeof f.page === 'string' &&
    typeof f.name === 'string' &&
    typeof f.type === 'string' &&
    typeof f.autocomplete === 'string' &&
    typeof f.label === 'string'
  )
}

function isRawStorageKey(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    (s.scope === 'local' || s.scope === 'session') &&
    typeof s.key === 'string' &&
    typeof s.bytes === 'number'
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
    typeof r.stoppedEarly === 'boolean' &&
    Array.isArray(r.cookies) &&
    r.cookies.every(isRawScanCookie) &&
    Array.isArray(r.formFields) &&
    r.formFields.every(isRawFormField) &&
    Array.isArray(r.storageKeys) &&
    r.storageKeys.every(isRawStorageKey) &&
    Array.isArray(r.consentMarkers) &&
    r.consentMarkers.every((m: unknown) => typeof m === 'string') &&
    typeof r.capturedAtEpochSeconds === 'number'
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

/** What the document picker produced, sorted for the caller: readable text, and the rest. */
export interface ExtractedDocuments {
  documents: DocumentText[]
  /** File names that could not be read. Names only — no path ever crosses this boundary. */
  unreadable: string[]
  /** File names whose text hit a cap and was cut short. */
  truncated: string[]
  /**
   * File names that were read but held no text at all — a scanned or photographed PDF is the
   * usual case. Distinct from `unreadable`: nothing went wrong, there was simply nothing to
   * read, and silently contributing nothing is how a user concludes the tool missed something.
   */
  noText: string[]
}

interface RawExtract {
  name: string
  text?: unknown
  truncated?: unknown
  error?: unknown
}

function isRawExtract(v: unknown): v is RawExtract {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).name === 'string'
}

/**
 * Opens the native multi-select dialog (Rust side, like `open_project`) and returns the
 * extracted text of every picked file. The text lives in memory for this session only —
 * nothing here is stored, and the caller passes it straight to `extractCandidates`.
 */
export async function pickAndExtractDocuments(): Promise<ExtractedDocuments> {
  const raw = await invoke<unknown>('pick_and_extract_documents')
  if (!Array.isArray(raw) || !raw.every(isRawExtract)) throw new Error(STRINGS.documentsFailed)

  const documents: DocumentText[] = []
  const unreadable: string[] = []
  const truncated: string[] = []
  const noText: string[] = []
  for (const entry of raw) {
    if (typeof entry.error === 'string' || typeof entry.text !== 'string') {
      unreadable.push(entry.name)
      continue
    }
    if (entry.text.trim() === '') {
      noText.push(entry.name)
      continue
    }
    documents.push({ name: entry.name, text: entry.text })
    if (entry.truncated === true) truncated.push(entry.name)
  }
  return { documents, unreadable, truncated, noText }
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
