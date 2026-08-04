# Traccia

[![build](https://github.com/JeruMarciano/traccia/actions/workflows/build.yml/badge.svg)](https://github.com/JeruMarciano/traccia/actions/workflows/build.yml)

A local-only desktop app that maps where an organisation's personal data goes.

Enter a website address, run a scan, and Traccia draws one picture: the third-party services
the site sends data to, arranged around the organisation that answers for them. Click any point
to see what is known about it, where each fact came from, and what nobody has answered yet.
Print the sheet to PDF when you need to hand it over.

A scan is a starting point, never a finished map. Whatever Traccia could not work out is marked
"not yet identified" so that a person can finish the job.

## Download

**[v0.3.0 (beta)](https://github.com/JeruMarciano/traccia/releases/latest)**

| | Installer | Portable, nothing installed |
|---|---|---|
| **macOS** | [`Traccia_0.3.0_universal.dmg`](https://github.com/JeruMarciano/traccia/releases/download/v0.3.0/Traccia_0.3.0_universal.dmg) | [`Traccia_0.3.0_universal_portable.app.zip`](https://github.com/JeruMarciano/traccia/releases/download/v0.3.0/Traccia_0.3.0_universal_portable.app.zip) |
| **Windows** | [`Traccia_0.3.0_x64-setup.exe`](https://github.com/JeruMarciano/traccia/releases/download/v0.3.0/Traccia_0.3.0_x64-setup.exe) | [`Traccia_0.3.0_x64_portable.exe`](https://github.com/JeruMarciano/traccia/releases/download/v0.3.0/Traccia_0.3.0_x64_portable.exe) |

The macOS builds are universal, running on Apple Silicon and Intel alike. Checksums for all four
downloads: [`SHA256SUMS.txt`](https://github.com/JeruMarciano/traccia/releases/download/v0.3.0/SHA256SUMS.txt).

The portable copies are the same application without the wizard. They run where they sit, from a
Downloads folder or a USB stick, asking for no administrator rights and leaving no entry in the
system's list of installed programs, which is what you want on a machine you do not own.

None of these downloads is signed, so your operating system will warn you the first time you open
the app, portable copies included. That warning is about the absence of a paid signing certificate, not about the app.
[docs/INSTALL.md](docs/INSTALL.md) shows what you will see, how to get past it once, and how to
install from the terminal with the checksum checked first. A scan needs Google Chrome or Microsoft
Edge installed; Traccia drives whichever it finds and never bundles a browser.

It is a beta: the file format is still settling, and so far one pair of hands has used it.

## Who it's for

Privacy consultants who need a first draft from whatever a client can hand over, plus a
defensible list of what is still missing. Also in-house DPOs and owners mapping their own
organisation, where the map is meant to improve over months rather than be finished in an
afternoon. Neither is assumed to be technical.

## Privacy by construction

The app has no account, no server, no telemetry, no crash reporting and no update check. The
only network traffic it ever produces is the scan of an address you typed in yourself. Projects
are plain files on your machine.

Unknowns are reported as "not yet identified", and nothing is ever labelled a violation. Traccia
maps what is there; judging it against a regulation is the reader's job.

## What a scan cannot see

The limits are stated here because a sheet is only trustworthy if they are. A scan observes the
connections a site makes from a visitor's browser. It cannot see anything behind a login, data
moving inside the organisation, anything that is not on the web, or connections made over secure
WebSockets (wss://), so a vendor reached only that way will not appear at all. Every printed
sheet carries this statement on it.

The no-traffic promise is not a matter of trust: `src-tauri/tests/egress.rs` fails the build if
the app attempts any connection beyond the site being scanned.

## Running from source

You need Node.js, a stable Rust toolchain, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm install
npm run dev
```

## Development

```bash
npm test           # Vitest, all suites
npm run typecheck  # tsc, no emit
```

From `src-tauri/`:

```bash
cargo test
cargo clippy --all-targets -- -D warnings
```

The domain logic lives in `src/core/` and is deliberately pure: no filesystem, no network, no
Tauri APIs, no clocks, no randomness. Timestamps and identifiers are passed in as parameters,
which is what keeps the whole of it testable without a browser.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers the checks a change has to pass and the constraints
that are load-bearing rather than stylistic. The two that rule out the most designs: the app
makes no network request other than the scan the user asked for, and `src/core/` stays free of
I/O and clocks.

The specifications behind each release are in [`docs/design/`](docs/design). What was decided
along the way, and what was measured, including a measurement that later turned out to be wrong,
is in [`docs/decisions/`](docs/decisions).

## Status

**v0.3.0 is out as a beta.** [Download it here](https://github.com/JeruMarciano/traccia/releases/latest):
a universal `.dmg` for macOS, an installer for Windows, and checksums for both. Beta because the
installers are unsigned, the project-file format is still settling, and one pair of hands has used
it so far.

Scanning a website and printing the map came first. Then document reading: hand Traccia a
privacy notice or a DPA and it offers what the text appears to describe, for you to confirm.
Nothing reaches the map unaccepted, and the documents themselves are never kept. After that came
depth, meaning cookies and their lifetimes, the pages that collect data, storage keys by name and
size but never value, and whether a consent mechanism was present.

Most recently the map itself was redrawn. It now reads as a sentence: whose data, through which
door, to the organisation answering for it, and onward to whom. A side panel states what is known
about any point along with the source of each fact, and rolls everything unanswered into a single
line.

Installers for macOS and Windows come out of the build workflow. Releases are made by hand,
because an app that never contacts a server cannot update itself.

## License

[MIT](LICENSE). Traccia's dependencies include five MPL-2.0 licensed Rust crates, pulled in
unmodified by Tauri; their licences apply to those files only. They are named, with their
upstream sources, in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
