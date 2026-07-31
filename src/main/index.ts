import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { installEgressGuard } from './egressGuard'
import { registerIpc } from './ipc'
import { writeCrashLine } from './log'

// The npm package name stays "dataflow-tool" (package.json), but the product the user sees — and
// the folder its local, never-uploaded crash log lives in (see docs/INSTALL.md) — is "Traccia".
// Electron otherwise derives app.getPath('userData') from package.json's "name" field.
app.setName('Traccia')

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
  // Closes window.open and target=_blank: a child window would be created outside these
  // webPreferences and could load a remote URL.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // Closes page-initiated navigation away from the bundled app, e.g. a link or a script setting
  // location.href, which would replace the renderer with content this app does not control.
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  // §7 forbids crash reporting: nothing is ever uploaded. This writes a local line the user can
  // find and choose to share, so an unhandled error does not simply vanish.
  process.on('uncaughtException', (err) => {
    void writeCrashLine(app.getPath('userData'), `uncaught: ${err.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    void writeCrashLine(app.getPath('userData'), `unhandled: ${String(reason)}`)
  })
  // Closes an egress path the webRequest guard cannot see: Chromium otherwise auto-upgrades DNS
  // to a third-party DoH resolver over HTTPS, and resolver traffic never reaches
  // session.webRequest. Must precede the guard and any window.
  app.configureHostResolver({ secureDnsMode: 'off' })
  // Closes every permission request (geolocation, camera, microphone, notifications, and the
  // rest): Electron grants them by default when no handler is installed, and geolocation in
  // particular is serviced by the browser process outside session.webRequest, where the egress
  // guard cannot see it.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
  // Closes the same permissions on the synchronous check path, which Chromium consults without
  // ever raising a request.
  session.defaultSession.setPermissionCheckHandler(() => false)
  // Installed before any window exists, so nothing escapes during startup.
  installEgressGuard(session.defaultSession, () => scanOrigins)
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
