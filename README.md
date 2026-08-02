# Traccia

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

## Status

v0.1 — external map. Scans a website, maps the third-party services it sends data to,
shows details per service, and prints the map to PDF.

## License

[MIT](LICENSE). Traccia's dependencies include a small number of MPL-2.0 licensed
Rust crates pulled in by Tauri; their licenses apply to those files only.
