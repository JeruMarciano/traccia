// tests/build/noTracingSubscriber.test.ts
//
// The map is the sensitive thing this app holds: every host the scanned site touched, which is
// a record of who the organisation's data goes to. `chromiumoxide`'s WebSocket transport logs
// that record in the clear.
//
// `chromiumoxide-0.7.0/src/conn.rs` emits, on the CDP connection Task 7 puts on a live path:
//
//     :104  tracing::trace!("Sending {:?}", cmd);
//     :145  tracing::trace!("Received {:?}", msg);
//     :149  tracing::debug!(target: "...::parse_errors", msg = text, "Failed to parse raw WS message");
//     :150  tracing::error!("Failed to deserialize WS response {}", err);
//
// The `msg` field at :149 is the **raw WebSocket text** — the whole CDP message, URLs included.
//
// Today this discards. `tracing`'s macros are no-ops without a subscriber installed, and no
// subscriber crate is in the tree. That is the property this test pins, because it is a property
// nobody would think to re-check: adding `tracing-subscriber` or `tauri-plugin-log` for a
// debugging session is a one-line convenience that would silently start writing the user's map
// to stdout or to a log file, and §7 forbids exactly that kind of leak. `error!` and `debug!`
// are on by default at most subscribers' filter levels, so this would not even need `trace`.
//
// This asserts on src-tauri/Cargo.lock's package list rather than on Cargo.toml, so a subscriber
// arriving transitively — pulled in by some future dependency rather than declared here — is
// caught too. `tracing`, `tracing-core` and `tracing-attributes` are all *expected* in the lock
// (chromiumoxide depends on them); they emit nothing without a subscriber and are not forbidden.
//
// If a future task genuinely needs local diagnostics, the answer is not to lift this test: it is
// a subscriber that is opt-in, off by default, and filtered to exclude chromiumoxide's targets —
// and that is a security-auditor decision, made deliberately, not a line added in passing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOCK = join(__dirname, '../../src-tauri/Cargo.lock')

// Two halves, and both are needed.
//
// A denylist can only ever catch what someone thought of when they wrote it. The first version of
// this file listed eleven crates and missed `console-subscriber`, `sentry-tracing` and
// `tracing-opentelemetry` — all of which install a subscriber and send off-machine, so a
// transitive one would have been both a leak and an egress, which is precisely what this guard
// exists to catch. A security audit found that gap.
//
// So the primary rule is a *prefix* rule with a small allowlist: any locked package named
// `tracing-*` is refused unless it is one of the three the tree legitimately has. That catches
// the subscribers nobody thought of, including ones not yet written. The three allowed are the
// facade and its machinery, which emit nothing without a subscriber:
//
//   tracing             the macros themselves
//   tracing-core        the dispatcher those macros call into
//   tracing-attributes  the #[instrument] proc macro
//
// The denylist then covers what the prefix rule cannot see: subscribers and log sinks that do not
// carry the `tracing-` prefix.
const ALLOWED_TRACING_CRATES = ['tracing', 'tracing-core', 'tracing-attributes']

const SUBSCRIBER_CRATES = [
  // Subscribers that also transmit. These are the dangerous ones: a leak and an egress at once.
  'sentry',
  'sentry-tracing',
  'sentry-core',
  'console-subscriber',
  // Local sinks. No egress, but the map ends up on disk or on stdout, which §7 forbids too.
  'env_logger',
  'fern',
  'simplelog',
  'stderrlog',
  'syslog',
  'femme',
  'flexi_logger',
  'log4rs',
  'android_logger',
  'oslog',
  'tauri-plugin-log',
]

function lockedPackages(lock: string): string[] {
  return [...lock.matchAll(/^name = "([^"]+)"$/gm)].flatMap((m) => (m[1] ? [m[1]] : []))
}

describe('no tracing subscriber reaches the shipped binary', () => {
  const lock = readFileSync(LOCK, 'utf8')
  const packages = lockedPackages(lock)

  it('parses the lock file at all', () => {
    // Without this, a lock file this test cannot read would pass vacuously.
    expect(packages.length).toBeGreaterThan(100)
    expect(packages).toContain('chromiumoxide')
  })

  it('locks tracing itself, which is what makes the guard necessary', () => {
    // If this ever stops being true the comment above is stale and should be
    // re-read rather than trusted.
    expect(packages).toContain('tracing')
  })

  it('locks no tracing-* crate outside the three that emit nothing on their own', () => {
    // The half that catches what nobody thought of, including crates that do not exist yet.
    const unexpected = packages
      .filter((name) => name.startsWith('tracing-'))
      .filter((name) => !ALLOWED_TRACING_CRATES.includes(name))
    expect(unexpected).toEqual([])
  })

  for (const crate of SUBSCRIBER_CRATES) {
    it(`does not lock ${crate}`, () => {
      // The half that catches the sinks whose names the prefix rule cannot see.
      expect(packages).not.toContain(crate)
    })
  }

  it('the prefix rule would catch a subscriber the denylist never heard of', () => {
    // Positive control for the first half, using a name deliberately absent from SUBSCRIBER_CRATES.
    const tampered = lockedPackages(
      `${lock}\n[[package]]\nname = "tracing-opentelemetry"\nversion = "0.1.0"\n`
    )
    const unexpected = tampered
      .filter((name) => name.startsWith('tracing-'))
      .filter((name) => !ALLOWED_TRACING_CRATES.includes(name))
    expect(unexpected).toEqual(['tracing-opentelemetry'])
  })

  it('the denylist would catch a sink the prefix rule cannot see', () => {
    // Positive control for the second half: `sentry-tracing` does not start with "tracing-".
    const tampered = lockedPackages(
      `${lock}\n[[package]]\nname = "sentry-tracing"\nversion = "0.1.0"\n`
    )
    expect(tampered).toContain('sentry-tracing')
    expect(tampered.filter((n) => n.startsWith('tracing-'))).not.toContain('sentry-tracing')
  })
})
