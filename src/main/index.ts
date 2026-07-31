import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { installEgressGuard } from './egressGuard'
import { registerIpc } from './ipc'

/** Populated only while a scan is running. Empty in Phase 1. */
const scanOrigins: string[] = []

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Closes an egress path the webRequest guard cannot see: with spellcheck on, Chromium
      // downloads a hunspell dictionary from a Google-hosted URL through its own network stack,
      // which never reaches session.webRequest.
      spellcheck: false,
    },
  })
  win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  // Closes an egress path the webRequest guard cannot see: Chromium otherwise auto-upgrades DNS
  // to a third-party DoH resolver over HTTPS, and resolver traffic never reaches
  // session.webRequest. Must precede the guard and any window.
  app.configureHostResolver({ secureDnsMode: 'off' })
  // Installed before any window exists, so nothing escapes during startup.
  installEgressGuard(session.defaultSession, () => scanOrigins)
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
