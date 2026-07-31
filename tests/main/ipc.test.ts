// tests/main/ipc.test.ts
//
// Electron's ipcMain.handle wrapper writes whatever a handler throws to the process console.
// In a Finder-launched macOS build that goes to the system log and is collected by sysdiagnose,
// which users do hand to third parties. So the handlers must never throw an error carrying an
// absolute filesystem path or anything out of the user's map. These tests pin that down.
import { describe, it, expect, vi, beforeEach } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  readProjectFile: vi.fn(),
  writeProjectFile: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler): void => {
      mocks.handlers.set(channel, handler)
    },
  },
  dialog: {
    showOpenDialog: mocks.showOpenDialog,
    showSaveDialog: mocks.showSaveDialog,
  },
}))

vi.mock('../../src/main/projectFile', () => ({
  readProjectFile: mocks.readProjectFile,
  writeProjectFile: mocks.writeProjectFile,
}))

import { registerIpc } from '../../src/main/ipc'
import { createEmptyProject } from '../../src/core/project'
import type { Project } from '../../src/core/types'

const NOW = '2026-07-30T09:00:00.000Z'
const SECRET_PATH = '/Users/x/secret.json'

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return handler({}, ...args)
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  const outcome = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  if (outcome === null) throw new Error('Expected the handler to reject, but it resolved.')
  expect(outcome).toBeInstanceOf(Error)
  return outcome as Error
}

/** A project whose flow points at an id that does not exist, so validateProject quotes both ids. */
function projectWithDanglingFlow(): Project {
  const p = createEmptyProject('ACME GDPR map', NOW)
  p.flows.push({
    id: 'fl-1',
    from: 'pl-9',
    to: 'pl-9',
    dataDescription: 'Name, email',
    purpose: 'Fulfilling orders',
    sources: [],
    confidence: 'declared',
  })
  return p
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.showOpenDialog.mockReset()
  mocks.showSaveDialog.mockReset()
  mocks.readProjectFile.mockReset()
  mocks.writeProjectFile.mockReset()
  registerIpc()
})

describe('project:open', () => {
  it('returns the project the chosen file contains', async () => {
    const project = createEmptyProject('ACME GDPR map', NOW)
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [SECRET_PATH] })
    mocks.readProjectFile.mockResolvedValue(project)
    await expect(invoke('project:open')).resolves.toEqual(project)
  })

  it('returns null when the user cancels the dialog', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(invoke('project:open')).resolves.toBeNull()
    expect(mocks.readProjectFile).not.toHaveBeenCalled()
  })

  it('keeps the filesystem path out of the failure when the file cannot be read', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [SECRET_PATH] })
    mocks.readProjectFile.mockRejectedValue(
      new Error(`EACCES: permission denied, open '${SECRET_PATH}'`),
    )

    const err = await rejection(invoke('project:open'))
    expect(err.message).toBe('This file could not be read as a project.')
    expect(err.message).not.toContain(SECRET_PATH)
    expect(err.message).not.toContain('secret.json')
    expect(err.message).not.toContain('EACCES')
    // A cause would be printed by console.error along with the error itself, putting the path
    // back in the log through the back door.
    expect(err.cause).toBeUndefined()
  })

  it('keeps ids from the map out of the failure when the file does not validate', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [SECRET_PATH] })
    mocks.readProjectFile.mockRejectedValue(new Error('Flow fl-1 refers to unknown id: pl-9'))

    const err = await rejection(invoke('project:open'))
    expect(err.message).toBe('This file could not be read as a project.')
    expect(err.message).not.toContain('fl-1')
    expect(err.message).not.toContain('pl-9')
    expect(err.cause).toBeUndefined()
  })
})

describe('project:save', () => {
  it('writes the validated project and reports success', async () => {
    const project = createEmptyProject('ACME GDPR map', NOW)
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: SECRET_PATH })
    mocks.writeProjectFile.mockResolvedValue(undefined)

    await expect(invoke('project:save', project)).resolves.toBe(true)
    expect(mocks.writeProjectFile).toHaveBeenCalledWith(SECRET_PATH, project)
  })

  it('returns false when the user cancels the dialog', async () => {
    const project = createEmptyProject('ACME GDPR map', NOW)
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    await expect(invoke('project:save', project)).resolves.toBe(false)
    expect(mocks.writeProjectFile).not.toHaveBeenCalled()
  })

  it('keeps ids from the map out of the failure when the renderer sends an invalid project', async () => {
    const err = await rejection(invoke('project:save', projectWithDanglingFlow()))
    expect(err.message).toBe('The project could not be saved.')
    expect(err.message).not.toContain('fl-1')
    expect(err.message).not.toContain('pl-9')
    expect(err.cause).toBeUndefined()
    expect(mocks.writeProjectFile).not.toHaveBeenCalled()
  })

  it('keeps the filesystem path out of the failure when the write fails', async () => {
    const project = createEmptyProject('ACME GDPR map', NOW)
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: SECRET_PATH })
    mocks.writeProjectFile.mockRejectedValue(
      new Error(`EACCES: permission denied, open '${SECRET_PATH}'`),
    )

    const err = await rejection(invoke('project:save', project))
    expect(err.message).toBe('The project could not be saved.')
    expect(err.message).not.toContain(SECRET_PATH)
    expect(err.message).not.toContain('secret.json')
    expect(err.message).not.toContain('EACCES')
    expect(err.cause).toBeUndefined()
  })
})
