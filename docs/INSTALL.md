# Installing Traccia

Traccia is free and unsigned. Because it is unsigned, both operating systems will warn you the first
time you open it. Here is exactly what you will see and why.

## macOS

1. Open the `.dmg` and drag Traccia to Applications.
2. The first launch shows "Traccia cannot be opened because the developer cannot be verified."
3. Right-click the app, choose **Open**, then **Open** again in the dialog.
4. This is needed once.

## Windows

1. Run the `.exe`.
2. SmartScreen shows "Windows protected your PC."
3. Click **More info**, then **Run anyway**.

## From the terminal

The same download, done in a way that checks what arrived before installing it. Since nothing here
is signed, comparing the checksum is the only way to know you have exactly what the build produced.
Both checksums are published as `SHA256SUMS.txt` on the same release page.

macOS:

```bash
VERSION=0.3.0
BASE=https://github.com/JeruMarciano/traccia/releases/download/v$VERSION
curl -fL -o Traccia.dmg "$BASE/Traccia_${VERSION}_universal.dmg"
curl -fL -o SHA256SUMS.txt "$BASE/SHA256SUMS.txt"
shasum -a 256 Traccia.dmg   # compare this against the line for the .dmg in SHA256SUMS.txt
hdiutil attach Traccia.dmg
cp -R /Volumes/Traccia/Traccia.app /Applications/
hdiutil detach /Volumes/Traccia
```

Windows, in PowerShell:

```powershell
$VERSION = "0.3.0"
$BASE = "https://github.com/JeruMarciano/traccia/releases/download/v$VERSION"
Invoke-WebRequest "$BASE/Traccia_${VERSION}_x64-setup.exe" -OutFile Traccia-setup.exe
Invoke-WebRequest "$BASE/SHA256SUMS.txt" -OutFile SHA256SUMS.txt
Get-FileHash Traccia-setup.exe -Algorithm SHA256   # compare against the line for the .exe
.\Traccia-setup.exe
```

There is no `curl | sh` installer, and there is not going to be one. That pattern asks you to pipe
a script off the internet straight into your shell, which is the opposite of what an app that makes
no network requests is arguing for. The commands above are short enough to read before you run them,
which is the point.

## Building it yourself

Anything you build on your own machine is not quarantined by the operating system, so it opens
without the warnings above. You need [Node.js](https://nodejs.org), a stable
[Rust toolchain](https://rustup.rs), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/JeruMarciano/traccia.git
cd traccia
npm ci
npm run tauri build
```

The installer lands in `src-tauri/target/release/bundle/`: a `.dmg` on macOS, an `.exe` and `.msi`
on Windows. To run it from source without building an installer at all, use `npm run dev`.

One caveat on macOS: this builds for your own architecture. The release `.dmg` is universal, which
is what `npm run tauri build -- --target universal-apple-darwin` produces, and that needs both
targets installed (`rustup target add aarch64-apple-darwin x86_64-apple-darwin`).

## Why the warnings

Signing an application requires paid certificates from Apple and a certificate authority. Traccia is
free and not signed yet. The warnings mean the operating system cannot confirm who published the app,
not that anything is wrong with it. Download only from the project's GitHub releases page.

## What Traccia sends over the network

Nothing, except when you explicitly scan a website address you have typed in. There is no telemetry,
no crash reporting, no update check, and no account. If the app hits an unexpected error it writes a
short line to a local log file and nothing else. You can find that log at:

- macOS: `~/Library/Application Support/Traccia/traccia.log`
- Windows: `%APPDATA%\Traccia\traccia.log`
