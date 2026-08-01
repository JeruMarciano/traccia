# Bundle measurement after the Tauri port

**Date:** 2026-08-01
**Commit:** `ed4f9b42d04f0695f5f330c0d506bbfb874a04a1` (branch `tauri-port`)
**Host:** macOS 24.6.0, Apple silicon, rustc 1.97.1, release profile

The spike's figures were taken before the proxy existed and before `tauri-plugin-dialog` was
added, and the spike's own findings doc said plainly that the proxy is small but not free, and
that it is now load-bearing. This is the re-measurement. A number nobody re-measures is a number
that drifts.

## Commands

```bash
source "$HOME/.cargo/env"
npm run tauri build

find src-tauri/target/release/bundle -name '*.dmg' -exec stat -f '%z %N' {} \;
stat -f '%z %N' src-tauri/target/release/traccia
du -sk src-tauri/target/release/bundle/macos/Traccia.app
du -sk dist

cd src-tauri && size -m target/release/traccia | head -20
```

Windows figures come from the `report the shipped size` step of the `bundle (windows-latest)`
job in `.github/workflows/build.yml` — run
[30702290214](https://github.com/JeruMarciano/traccia/actions/runs/30702290214). Windows cannot
be built on this Mac, so CI is the only source for them.

## The numbers

| Artefact | Bytes |
|---|---|
| Electron `Traccia-1.0.0-arm64.dmg` (Phase 1, for comparison) | 99,452,988 |
| Spike Tauri `.dmg` (CDP deps, no proxy) | 1,436,539 |
| **This build — macOS `Traccia_1.0.0_aarch64.dmg`** | **1,536,327** |
| **This build — Windows `Traccia_1.0.0_x64-setup.exe` (NSIS)** | **1,124,383** |
| macOS `Traccia.app` installed | 2,543,616 (2,484 KiB) |
| macOS binary `traccia` | 2,436,064 |
| `dist/` (built renderer) | 217,088 (212 KiB) |

The same macOS `.dmg` built on the CI runner measured 1,535,343 — 984 bytes below the local
figure. `.dmg` creation is not byte-reproducible; the difference is filesystem packing, not code.

No MSI. `tauri.conf.json` sets bundle targets `["dmg", "app", "nsis"]`, so Windows ships the NSIS
installer only. The workflow's artefact glob still lists `msi/*.msi` under `if-no-files-found:
warn`, which is why the job passes without one.

## Against Electron

**64.7× smaller** — 1,536,327 against 99,452,988, a saving of 97,916,661 bytes per download. At
1.47 MiB the macOS download is roughly an order of magnitude inside the 10–15 MB the port was
justified by, and Windows is smaller still at 1.07 MiB.

The spike claimed 69×. This build is 64.7× for the reason set out below; the ratio moved because
the numerator grew, not because Electron shrank.

## Against the spike, and what accounts for the delta

| | Spike | This build | Delta |
|---|---|---|---|
| Binary | 2,335,056 | 2,436,064 | **+101,008 (+4.3%)** |
| `.dmg` | 1,436,539 | 1,536,327 | +99,788 (+6.9%) |

Segment breakdown of this build's binary (`size -m`):

```
__TEXT        2,244,608     __text        1,623,796
                            __const         456,232
                            __cstring        62,525
                            __eh_frame       48,656
                            __unwind_info    28,376
__DATA_CONST    114,688
__DATA           32,768
```

Three changes sit between the two figures, pulling in opposite directions:

- **Added: the proxy** (`proxy.rs`, `admission.rs`). A CONNECT-only listener over `tokio`, which
  Tauri already depends on, so the marginal cost is the project's own code rather than a runtime.
  This is the cost the spike told us to budget for.
- **Added: `tauri-plugin-dialog`**, which wraps `rfd` — visible in the build log compiling `rfd
  v0.16.0` and `embed_plist`. Native open/save dialogs opened from Rust, so the renderer never
  holds a filesystem path. The larger of the two additions.
- **Not yet added back: the CDP dependency set.** `tokio-tungstenite` and `futures-util` were in
  the spike's binary and are absent here — CDP is Phase 2. So +101,008 bytes is a net figure that
  understates what the proxy and the dialog plugin cost, and Phase 2 will pay the CDP bytes again
  on top of it.

The honest reading: the proxy and the dialogs cost about 100 KB net while the CDP stack is out of
the tree. That is inside any reasonable budget, but it is not free, and Phase 2 should re-measure
rather than assume this figure carries.

## Verdict

Still comfortably inside the 10–15 MB the port was justified by, with the largest platform
download at 1.47 MiB — about one sixty-fifth of what Electron shipped.
