# Traccia

[![build](https://github.com/JeruMarciano/traccia/actions/workflows/build.yml/badge.svg)](https://github.com/JeruMarciano/traccia/actions/workflows/build.yml)

A local-only desktop app that maps where an organisation's personal data goes.

Enter a website URL, run a scan, and Traccia draws a single picture: the third-party
services the site sends data to, grouped around the organisation at the centre. Click
any point on the map to see what is known about it — what kind of service it is, what
data reaches it, and what has not yet been identified. Print the map to PDF when you
need to share it.

A scan is a starting point, never a finished map. Anything Traccia could not work out
is marked as "not yet identified" so a human can complete the picture.

## Who it's for

- **Privacy consultants** who need a fast draft map from whatever a client can hand
  over, and a defensible list of gaps.
- **In-house DPOs or owners** who want a map of their own organisation that improves
  over time.

Neither is assumed to be technical.

## Privacy by construction

- **Local only.** No account, no server, no telemetry, no crash reporting, no update
  checks. The only network traffic the app ever produces is the scan of a URL you
  explicitly entered.
- **Your data stays yours.** Projects are plain files on your machine.
- **Neutral language.** Unknowns are reported as "not yet identified" — Traccia is a
  mapping tool, not a compliance tool, and never labels anything a violation.

## What a scan cannot see

Stated here because the sheet is only trustworthy if its limits are: a scan observes the
connections a site makes from a visitor's browser. It does not see anything behind a
login, data moving inside the organisation, anything not on the web, or connections made
over secure WebSockets (wss://) — a vendor reached only that way will not appear. Every
printed sheet carries this statement on it. The no-traffic promise itself is enforced by
an automated test (`src-tauri/tests/egress.rs`) that fails the build if the app attempts
any connection beyond the scanned site.

## Install

Traccia is currently unsigned: macOS and Windows will warn about an app from an
unidentified developer. That is the absence of a paid certificate, not a judgment on the
app — on macOS, right-click the app and choose **Open**; on Windows, choose
**More info → Run anyway**.

- **macOS:** download the `.dmg` from Releases (about 1.6 MB), open it, drag Traccia to
  Applications.
- **Windows:** download and run the installer from Releases.

A scan needs Google Chrome or Microsoft Edge installed; Traccia finds whichever is there.

## Running from source

Prerequisites: Node.js, Rust (stable), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your platform.

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

The core domain logic lives in `src/core/` and is deliberately pure: no filesystem,
no network, no Electron/Tauri APIs, no clocks or randomness. Timestamps and IDs are
always passed in as parameters, which keeps it fully testable.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — it covers the checks a change has to pass and the
constraints that are load-bearing rather than stylistic (chiefly: the app makes no network
request other than the scan the user asked for, and `src/core/` stays free of I/O and clocks).

The design documents behind each release are in [`docs/design/`](docs/design), and what was
decided and measured along the way — including where an earlier measurement turned out to be
wrong — is in [`docs/decisions/`](docs/decisions).

## Status

Working, and used on real sites. Not yet released as a versioned build.

- **The external map** — scan a website, map the third-party services it contacts, print to PDF.
- **Documents** — read a privacy notice or a DPA and offer what it appears to describe, for
  confirmation. Nothing lands on the map without being accepted, and the documents themselves
  are never kept.
- **Depth** — cookies with their lifetimes, the pages that collect data, storage keys by name
  and size (never value), and whether a consent mechanism was present.
- **The controller-centred map** — the sheet reads as a sentence: whose data, through which door,
  to the organisation answering for it, onward to whom. A side panel states what is known about
  any point, with the source of each fact, and rolls what is not yet known into one line.

Installers are built for macOS and Windows from the build workflow; releases are made by hand,
because the app never contacts a server and so cannot update itself.

## License

[MIT](LICENSE). Traccia's dependencies include five MPL-2.0 licensed Rust crates pulled
in unmodified by Tauri; their licenses apply to those files only. They are named, with
their upstream sources, in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
