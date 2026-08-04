# Traccia

[![build](https://github.com/JeruMarciano/traccia/actions/workflows/build.yml/badge.svg)](https://github.com/JeruMarciano/traccia/actions/workflows/build.yml)

A local-only desktop app that maps where an organisation's personal data goes.

Enter a website address, run a scan, and Traccia draws one picture: the third-party services
the site sends data to, arranged around the organisation that answers for them. Click any point
to see what is known about it, where each fact came from, and what nobody has answered yet.
Print the sheet to PDF when you need to hand it over.

A scan is a starting point, never a finished map. Whatever Traccia could not work out is marked
"not yet identified" so that a person can finish the job.

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

## Install

Full instructions, including what the operating-system warnings mean, are in
[docs/INSTALL.md](docs/INSTALL.md).

On macOS, download the universal `.dmg` from Releases, open it and drag Traccia to Applications.
On Windows, download and run the installer. Both will warn you about an unidentified developer,
which reflects the absence of a paid signing certificate rather than anything about the app:
right-click and choose **Open** on macOS, or **More info** then **Run anyway** on Windows.

Prefer the terminal? [docs/INSTALL.md](docs/INSTALL.md) has the `curl` commands, including how to
check the download against its published checksum, which is worth doing precisely because nothing
here is signed. It also covers building the app yourself, which skips the warnings entirely since
the operating system does not quarantine what you built on your own machine.

A scan needs Google Chrome or Microsoft Edge installed. Traccia uses whichever it finds.

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
