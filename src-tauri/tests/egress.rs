//! The executable form of spec §7.1. If this file passes while the product
//! leaks, the product has no promise left, so every assertion here is written
//! to fail closed.
//!
//! Every test below drives `scan::run_pipeline` (via the `run_scan_for_test*`
//! seams `scan.rs` exposes for exactly this file) rather than reimplementing
//! any part of the orchestration: admission, browser launch, CDP observation,
//! teardown order and the ledger assertion are the real code `run` executes.
//! The one thing substituted is the connector — `proxy::real_connector()`
//! performs a real DNS lookup and then refuses to dial a loopback or private
//! address once it has resolved one (`is_permitted_upstream`), which is
//! exactly what the fixture below necessarily is, so no test in this file
//! could use it without either doing real name resolution or being refused
//! by the very check that makes the proxy safe. `run_pipeline`'s doc comment
//! in `scan.rs` says the same thing; this file is the reason it says it.
//!
//! No test performs name resolution. The scan target's hostname lives under
//! `.invalid` (RFC 2606: guaranteed never to resolve, by anyone, ever) and is
//! never looked up — the injected connector recognises it as a plain string
//! and dials the loopback fixture server directly. The fixture's own page
//! links three "off-site" hosts by IP literal, which `admission::decide`
//! denies before any connector is ever asked about them.
//!
//! **`the_browsers_own_background_traffic_is_silenced` takes an
//! allowlist-with-documented-exceptions form, not a bare denylist.** The
//! promise this whole suite exists to check is enforced by the proxy: every
//! attempt in a scan's denied set was refused, so nothing actually left the
//! machine regardless of what the browser tried. That test asserts two
//! separate things, both required to make the assertion mean something: (a)
//! nothing was *allowed* except the scan target itself, and (b) no
//! *undocumented* attempt occurred — every denied host is either one of the
//! fixture's own three off-site IP literals or a member of
//! `KNOWN_DENIED_BROWSER_SERVICE_HOSTS`, a short, named, commented list of
//! browser background subsystems (GAIA account listing, GCM device checkin,
//! search preconnect remnants) for which a bounded, evidence-based search
//! found no switch in the pinned Chrome 151.0.7922.72 that suppresses the
//! attempt itself — see that const's own doc comment and `browser.rs`'s
//! `launch_flags` comment for the verification chain behind each entry. A
//! host showing up outside that documented set is the finding this test
//! exists to catch: a new background subsystem, or an actual leak.
//!
//! **What this suite cannot see — a limitation class, not a per-test caveat.**
//! Every assertion here reads `proxy::Ledger`, which only ever learns about a
//! connection that reached the proxy's TCP listener. That is not the same
//! claim as "no packet left the machine". In particular this suite is blind
//! to: QUIC/UDP traffic (mitigated by `--disable-quic` and
//! `--webrtc-ip-handling-policy=disable_non_proxied_udp` in `browser.rs`, but
//! not observed here — nothing in this file counts a UDP datagram except the
//! separate, `#[ignore]`d DNS sensor below); a `file://` URL naming a remote
//! (SMB) authority, which is `docs/decisions/2026-07-31-admission-audit.md`
//! §1's still-open item — `browser::url_is_permitted` specifies the rule but,
//! per its own doc comment, is not wired to any enforcement point, and this
//! suite does not exercise `file://` targets at all; and mDNS, which never
//! passes through an HTTP/HTTPS proxy listener regardless of what discovers
//! it. None of these is asserted absent anywhere in this file. Recorded
//! plainly rather than implied by omission.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};

use traccia_lib::proxy::{self, Ledger};
use traccia_lib::scan::{self, ScanState, Target};

// ---------------------------------------------------------------------------
// The fixture site
// ---------------------------------------------------------------------------

/// The page every fixture serves. Three off-site hosts by IP literal — never
/// resolved, never dialled, and `admission::decide` denies an IP literal
/// unconditionally (`DenyReason::IpLiteral`) before any connector sees it —
/// which is what proves the third assertion in
/// `a_scan_contacts_the_target_and_nothing_else` is testing something real
/// rather than an empty ledger nobody ever tried to fill.
const FIXTURE_HTML: &str = concat!(
    "<!doctype html><html><body>",
    "<img src=\"http://192.0.2.10/pixel.gif\">",
    "<script src=\"http://198.51.100.20/track.js\"></script>",
    "<link rel=\"stylesheet\" href=\"http://203.0.113.30/style.css\">",
    "</body></html>",
);

/// A loopback HTTP server standing in for a scanned website, plus the
/// scan-target host the test suite tells `scan.rs` to open. The host is a
/// plain, dotted, non-IP string under `.invalid` so it passes every check
/// `admission::vet_host` and `scan::Target` construction would apply to a
/// real one; it is never resolved, because the connector below recognises it
/// as a string and dials the loopback listener directly.
struct Site {
    host: String,
    origin_port: u16,
}

impl Site {
    fn target(&self) -> Target {
        Target {
            url: format!("http://{}/", self.host),
            host: self.host.clone(),
            origins: vec![self.host.clone()],
        }
    }

    /// The one seam `run_pipeline` allows a test to substitute. Recognises
    /// exactly `(self.host, 80)` — the only pair `admission::decide` will
    /// ever admit for this scan's origins — and dials the loopback fixture
    /// listener directly, performing no name resolution at all. Anything
    /// else reaching this connector would mean `admission::decide` admitted
    /// a host this scan never should have, so it is refused rather than
    /// guessed at.
    fn connector(&self) -> proxy::Connector {
        let host = self.host.clone();
        let origin_port = self.origin_port;
        Arc::new(move |h: String, p: u16| {
            let dial = (h == host && p == 80).then_some(origin_port);
            Box::pin(async move {
                match dial {
                    Some(port) => TcpStream::connect(("127.0.0.1", port)).await,
                    None => Err(std::io::Error::other(
                        "test connector: admitted a host the fixture does not recognise",
                    )),
                }
            }) as proxy::BoxFuture<'static, std::io::Result<TcpStream>>
        })
    }
}

/// Starts the loopback fixture server and returns the `Site` describing it.
/// A fresh listener and a fresh, port-derived host per call, so concurrent
/// tests never share one scan's admitted origin with another's.
async fn fixture_site() -> Site {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind loopback fixture listener");
    let addr: SocketAddr = listener.local_addr().expect("fixture listener address");
    tokio::spawn(async move {
        loop {
            let Ok((stream, _peer)) = listener.accept().await else {
                break;
            };
            tokio::spawn(serve_fixture_page(stream));
        }
    });
    Site {
        host: format!("scan-fixture-{}.invalid", addr.port()),
        origin_port: addr.port(),
    }
}

/// Answers one plain-HTTP request with `FIXTURE_HTML`.
///
/// Reads to EOF rather than one `read()` call, because `proxy.rs`'s
/// plain-HTTP forwarding always shuts its write half immediately after
/// sending the request head (there is no body to follow — see `proxy.rs`'s
/// `Mode::Forward` arm) before reading the response. That is a normal
/// TCP half-close, not an abort, and an HTTP/1.1 origin server is expected to
/// keep reading and then respond; reading to EOF here is what makes this
/// fixture that kind of server rather than one that answers before the whole
/// request has arrived. Carried risk (a) from the task brief — whether a
/// *real* origin server would instead treat the early FIN as an abort — is
/// a property of servers this suite does not control and remains open.
async fn serve_fixture_page(mut stream: TcpStream) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        FIXTURE_HTML.len(),
        FIXTURE_HTML,
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

// ---------------------------------------------------------------------------
// Scan-pipeline helpers
// ---------------------------------------------------------------------------

/// Runs the real pipeline (`scan::run_pipeline`, via `run_scan_for_test`)
/// against `site` and hands back the ledger it produced — only if the scan
/// itself reported success, so `.expect("scan should complete")` at the call
/// site means what it says rather than papering over a scan that failed but
/// still left an inspectable ledger behind.
async fn run_scan_against(site: &Site) -> Result<Arc<Ledger>, String> {
    let state = Arc::new(ScanState::default());
    let run = scan::run_scan_for_test(state, site.target(), site.connector()).await?;
    match run.result {
        Ok(_) => Ok(run.ledger),
        Err(e) => Err(e),
    }
}

/// Runs the real pipeline against `site`, poisoning this scan's ledger after
/// teardown and before the ledger assertion — the exact seam `scan.rs`'s
/// `run_pipeline` exposes for this. Asserts the *scan's* rule, in the scan's
/// own code, not a reimplementation of it: `ledger.healthy()` deliberately
/// stays true when records were dropped (that is `proxy.rs`'s call, for the
/// proxy, so a full ledger does not turn off the guard); the stricter rule
/// that a scan must not report success on top of a dropped record lives in
/// `scan::ledger_is_consistent`, and this is what exercises it.
async fn run_scan_with_poisoned_ledger(site: &Site) -> Result<(), String> {
    let state = Arc::new(ScanState::default());
    let run =
        scan::run_scan_for_test_with_poisoned_ledger(state, site.target(), site.connector())
            .await?;
    run.result.map(|_| ())
}

async fn run_scan_and_return_profile_path(site: &Site) -> PathBuf {
    let state = Arc::new(ScanState::default());
    let run = scan::run_scan_for_test(state, site.target(), site.connector())
        .await
        .expect("scan should complete");
    run.profile_dir
}

/// Launches the scan, captures the browser's pid and profile directory the
/// moment they exist (via the launch hook `run_pipeline` calls before
/// observation starts), cancels through the same public `scan::cancel` the
/// renderer's stop button calls, and only then lets the pipeline finish —
/// bounded by a generous timeout so a cancel that did nothing is a loud
/// failure (the run not finishing) rather than a silent one.
async fn run_scan_and_cancel_midway(site: &Site) -> (PathBuf, u32) {
    let state = Arc::new(ScanState::default());
    let (tx, rx) = tokio::sync::oneshot::channel::<(u32, PathBuf)>();
    let hook: scan::LaunchHook = Box::new(move |pid, path| {
        let _ = tx.send((pid, path.to_path_buf()));
    });

    let handle = tokio::spawn(scan::run_scan_for_test_with_launch_hook(
        Arc::clone(&state),
        site.target(),
        site.connector(),
        hook,
    ));

    let (pid, profile) = rx.await.expect("browser launched before the scan finished");
    scan::cancel(&state);

    // The inner `Result<ScanRun, String>` is discarded deliberately, not overlooked: a
    // cancelled scan is expected to come back `Err` (cancellation is not success), and this
    // test's job is to prove teardown ran regardless of that outcome, not to pin its exact
    // error token. The two `.expect()`s above are the assertions that matter here — that the
    // task didn't hang and didn't panic.
    let _ = tokio::time::timeout(Duration::from_secs(30), handle)
        .await
        .expect("a cancelled scan did not finish within 30s — stop did not stop it")
        .expect("scan task panicked");

    (profile, pid)
}

/// Whether the process named by `pid` is still alive. Implemented with the
/// platform's own process-listing tools rather than a new dependency: `kill
/// -0` signals nothing and only reports whether the pid exists on Unix,
/// and `tasklist` filtered to the pid does the same on Windows.
#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    let Ok(output) = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
}

// ---------------------------------------------------------------------------
// The DNS sensor
// ---------------------------------------------------------------------------

/// Counts UDP datagrams arriving on the loopback DNS port, and can report
/// whether it is still bound — the sensor check `no_dns_query_leaves_the_
/// machine` asks before trusting its own silence.
struct DnsObserver {
    bound: bool,
    count: Arc<AtomicU64>,
}

impl DnsObserver {
    fn queries_seen(&self) -> u64 {
        self.count.load(Ordering::SeqCst)
    }
    fn is_alive(&self) -> bool {
        self.bound
    }
}

/// Binds loopback UDP port 53 — the real system resolver port, not a
/// stand-in — and counts every datagram it receives for the rest of the
/// process's life. Binding a port below 1024 needs a privilege this suite
/// does not assume the test runner has; see the `#[ignore]` on
/// `no_dns_query_leaves_the_machine` for what that means for this
/// observable when the privilege is absent.
async fn dns_observer() -> DnsObserver {
    match UdpSocket::bind("127.0.0.1:53").await {
        Ok(socket) => {
            let count = Arc::new(AtomicU64::new(0));
            let counting = Arc::clone(&count);
            tokio::spawn(async move {
                let mut buf = [0u8; 512];
                while socket.recv_from(&mut buf).await.is_ok() {
                    counting.fetch_add(1, Ordering::SeqCst);
                }
            });
            DnsObserver { bound: true, count }
        }
        Err(_) => DnsObserver {
            bound: false,
            count: Arc::new(AtomicU64::new(0)),
        },
    }
}

// ---------------------------------------------------------------------------
// The promise
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_scan_contacts_the_target_and_nothing_else() {
    // A fixture site served from loopback, which links out to three hosts that
    // must never be contacted. No name resolution anywhere.
    let site = fixture_site().await;
    let ledger = run_scan_against(&site).await.expect("scan should complete");

    for (host, _port) in ledger.allowed() {
        assert_eq!(host, site.host, "contacted a host outside the scan target");
    }
    assert!(!ledger.denied().is_empty(), "the fixture's third parties were never attempted — the test is not testing anything");
}

#[tokio::test]
async fn the_scan_fails_rather_than_reporting_clean_when_the_ledger_dropped_records() {
    // The control: an otherwise-identical scan, against a fresh fixture instance,
    // with no poisoning, must still succeed. Without this the test below would go
    // green on *any* failure — including one that has nothing to do with the
    // ledger, such as no browser being installed on the runner — and never prove
    // the poison is what caused the error.
    let control_site = fixture_site().await;
    let control = run_scan_against(&control_site).await;
    assert!(
        control.is_ok(),
        "the unpoisoned control scan itself failed, so the poisoned case below proves \
         nothing: {control:?}"
    );

    let site = fixture_site().await;
    let outcome = run_scan_with_poisoned_ledger(&site).await;
    assert_eq!(
        outcome,
        Err(scan::SCAN_FAILED.to_string()),
        "a scan whose observer lost records must fail with SCAN_FAILED specifically, \
         not any other error"
    );
}

/// The fixture's three off-site IP literals, in the order `FIXTURE_HTML` links them —
/// always present in a scan's denied set, since `admission::decide` denies an IP
/// literal unconditionally before any connector is ever asked about it. Used both as
/// the sensor-is-not-vacuous check and as fixture noise excluded from the "nothing
/// undocumented" comparison below.
const FIXTURE_IP_LITERALS: [&str; 3] = ["192.0.2.10", "198.51.100.20", "203.0.113.30"];

/// The residual set of hosts a launched, fully-flagged Chrome 151.0.7922.72 was
/// observed attempting during a scan, beyond the fixture's own off-site links, after
/// every verified-present suppression this project could find was applied and
/// measured (see `browser.rs`'s `launch_flags` doc comment for the full chain of
/// evidence, and the "bounded final suppression attempt" note at the end of this
/// list for the round that closed this residual set out).
///
/// This is an **allowlist of known, documented, already-denied exceptions** — every
/// one of these attempts is refused by the proxy (nothing leaves the machine; see
/// this file's doc comment for what "the proxy is the enforcement point" means) —
/// not a claim that any of it is acceptable to leave unsuppressed forever. A host
/// appearing in a scan's denied set that is **not** in this list is the finding this
/// test exists to catch.
const KNOWN_DENIED_BROWSER_SERVICE_HOSTS: [(&str, &str); 4] = [
    (
        "www.gstatic.com",
        "connectivity/search-choice-family request; no distinct switch found beyond \
         what browser.rs already applies (see PreconnectToSearch note there)",
    ),
    (
        "accounts.google.com",
        "GAIA account listing — AccountReconcilor's unconditional ListAccounts check, \
         run by signin/account-consistency infrastructure on profile startup \
         independent of any signed-in account; no --disable-features name or \
         command-line switch verified present in Chrome 151 (searched \
         account-consistency/AccountReconcilor/Gaia*/Dice* naming patterns, and the \
         one candidate feature name found near this subsystem, \
         AvoidAutoTriggerListAccountsOnStale, was tried and verified to have no \
         measurable effect on this ledger)",
    ),
    (
        "www.google.com",
        "search-engine preconnect remnant — SearchEnginePreconnector's periodic \
         idle-time preconnect to the default search engine; PreconnectToSearch and \
         PreconnectToSearchDesktop (already in browser.rs's --disable-features list) \
         cut this from 12 to 5 attempts per scan, verified by repeated instrumented \
         runs, but did not reach zero and no further verified switch was found",
    ),
    (
        "android.clients.google.com",
        "GCM device checkin — the legacy GCMProfileService checkin endpoint, used \
         regardless of which higher-level feature (push messaging, Cast, \
         optimization-guide push) ultimately consumes it; no --disable-features name \
         or command-line switch verified present in Chrome 151 (searched GCM*/ \
         checkin/Push* naming patterns — the GCM* strings present, e.g. GCMKeyStore, \
         GCMUseDedicatedNetworkThread, are metrics/tuning parameters, not an on/off \
         feature)",
    ),
];

#[tokio::test]
async fn the_browsers_own_background_traffic_is_silenced() {
    // A component extension made requests even in a fresh profile during the
    // spike, until --disable-background-networking was passed. This test asserts
    // an allowlist-with-documented-exceptions, not a bare denylist: it is not
    // vacuous only because the fixture literals and the target host are both
    // asserted actually attempted, and any host outside the documented set fails
    // loudly by name.
    let site = fixture_site().await;
    let ledger = run_scan_against(&site).await.expect("scan should complete");

    let denied = ledger.denied();

    for literal in FIXTURE_IP_LITERALS {
        assert!(
            denied.iter().any(|(h, _, _)| h == literal),
            "the fixture's own off-site link to {literal} was never attempted — \
             the sensor check above is vacuous"
        );
    }

    let allowed = ledger.allowed();
    assert!(!allowed.is_empty(), "the scan target itself was never contacted");
    for (host, _port) in &allowed {
        assert_eq!(host, &site.host, "contacted a host outside the scan target");
    }

    // These three stay forbidden absolutely, distinct from the documented residual
    // set above: gvt1.com (Google's component-update/Widevine CDN, closed by
    // --disable-component-update) and mtalk.google.com (GCM's legacy XMPP push
    // channel, closed by --disable-background-networking / --disable-sync) are
    // well-known Chromium background-traffic hosts this project has not itself
    // observed attempted against the current flag set. clients2.google.com *was*
    // observed and is the one entry in this trio with a verified before/after: it
    // is `NetworkTimeTracker`'s target (see browser.rs's launch_flags doc comment),
    // present in the denied set before `NetworkTimeServiceQuerying` was added to
    // --disable-features and confirmed absent in every instrumented run since. If
    // any of these three ever reappears, the flag that was verified to close it has
    // regressed or a new caller of the same host has appeared.
    for forbidden in ["gvt1.com", "mtalk.google.com", "clients2.google.com"] {
        assert!(
            !denied.iter().any(|(h, _, _)| h == forbidden),
            "{forbidden} appeared in the denied set — a flag verified to silence this \
             host has regressed"
        );
    }

    let known_hosts: Vec<&str> = KNOWN_DENIED_BROWSER_SERVICE_HOSTS
        .iter()
        .map(|(h, _)| *h)
        .collect();
    let undocumented: Vec<_> = denied
        .iter()
        .filter(|(h, _, _)| {
            !FIXTURE_IP_LITERALS.contains(&h.as_str()) && !known_hosts.contains(&h.as_str())
        })
        .collect();
    assert!(
        undocumented.is_empty(),
        "the browser attempted a host outside the documented set — a new background \
         subsystem or a leak; investigate before widening this list: {undocumented:?}"
    );
}

#[tokio::test]
#[ignore = "binding loopback UDP port 53 needs a privilege (root, or Windows equivalent) this \
suite does not assume the runner has, and this suite deliberately does not repoint the OS \
resolver to make an unprivileged port meaningful — that would be a side effect on the host \
outside what a test is allowed. Run manually with elevated privileges to exercise this; recorded \
as unverified-by-CI in the Task 13 handover."]
async fn no_dns_query_leaves_the_machine() {
    // With an HTTP proxy the browser resolves proxy-side. That is a property of
    // how the browser is launched, so it is asserted rather than assumed.
    let site = fixture_site().await;
    let observer = dns_observer().await;
    let _ = run_scan_against(&site).await.expect("scan should complete");
    assert_eq!(observer.queries_seen(), 0);
    assert!(observer.is_alive(), "the DNS observer died — this result means nothing");
}

#[tokio::test]
async fn the_profile_directory_is_gone_afterwards() {
    let site = fixture_site().await;
    let profile = run_scan_and_return_profile_path(&site).await;
    assert!(!profile.exists(), "ephemeral profile survived the scan");
}

#[tokio::test]
async fn a_cancelled_scan_leaves_no_browser_running_and_no_profile_behind() {
    let site = fixture_site().await;
    let (profile, child_pid) = run_scan_and_cancel_midway(&site).await;
    assert!(!profile.exists());
    assert!(!process_is_alive(child_pid));
}
