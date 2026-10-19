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
//! No test performs name resolution. The scan target's hostname and the
//! fixture's named third party both live under `.invalid` (RFC 2606:
//! guaranteed never to resolve, by anyone, ever) and are never looked up — the
//! injected connector recognises them as plain strings and dials the loopback
//! fixture listeners directly. The fixture's own page also links three
//! "off-site" hosts by IP literal, which `admission::decide` denies before any
//! connector is ever asked about them.
//!
//! During a scan `admission::decide` admits any named host on 80/443, as a
//! visitor's browser would reach it (Chrome's own service hosts excepted: three named ones are
//! refused as `DenyReason::BrowserService`); in the product the guard on those is
//! `proxy::is_permitted_upstream` on every resolved address. Here the guard is
//! the test connector: it dials only the two fixture names and refuses every
//! other admitted host, so nothing a test scan admits leaves the machine.
//!
//! **`the_browsers_own_background_traffic_never_becomes_a_site_host` takes an
//! allowlist-with-documented-exceptions form, not a bare denylist.** It
//! asserts two separate things, both required to make the assertion mean
//! something: (a) no browser service host is reported as a host the *site*
//! contacted, and (b) no *undocumented* attempt occurred — every host the
//! proxy saw, admitted or denied, is the scan target, the fixture's third
//! party, one of its three off-site IP literals, or a member of
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

mod common;

use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::net::UdpSocket;

use traccia_lib::admission::DenyReason;
use traccia_lib::proxy::Ledger;
use traccia_lib::scan::{self, ScanOutput, ScanState};

use common::{fixture_site, Site, THIRD_PARTY_HOST};

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

/// Like `run_scan_against`, but also hands back what the renderer would
/// receive, so a test can compare what the proxy admitted with what the scan
/// reports as the site's hosts.
async fn run_scan_with_output(site: &Site) -> (Arc<Ledger>, ScanOutput) {
    let state = Arc::new(ScanState::default());
    let run = scan::run_scan_for_test(state, site.target(), site.connector())
        .await
        .expect("scan should start");
    (run.ledger, run.result.expect("scan should complete"))
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
    let (tx, rx) = tokio::sync::oneshot::channel::<(u32, PathBuf, bool)>();
    let hook: scan::LaunchHook = Box::new(move |pid, path| {
        // Read here, while the profile exists; asserted below, once the browser is torn down.
        let seeded = std::fs::read_to_string(path.join("Default").join("Preferences"))
            .is_ok_and(|prefs| prefs.contains("default_directory"));
        let _ = tx.send((pid, path.to_path_buf(), seeded));
    });

    let handle = tokio::spawn(scan::run_scan_for_test_with_launch_hook(
        Arc::clone(&state),
        site.target(),
        site.connector(),
        hook,
    ));

    // A closed channel means the hook never fired, so the pipeline ended before it launched
    // anything. That is a different failure from the one this test is about, and saying
    // "browser launched before the scan finished" for it sends the reader looking at cancel
    // when the truth is usually that no browser could be started on this machine. Wait for the
    // task and report what actually went wrong.
    let (pid, profile, seeded) = match rx.await {
        Ok(launched) => launched,
        Err(_) => match handle.await.expect("scan task panicked") {
            Err(e) => panic!("the scan ended before launching a browser: {e}"),
            Ok(_) => panic!("the scan completed without ever launching a browser"),
        },
    };
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

    assert!(seeded, "the download Preferences were not in the profile when Chrome was launched");
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
async fn a_scan_reaches_a_named_third_party_but_never_an_ip_literal() {
    // A fixture site served from loopback, which loads one named third party
    // (admitted, as a visitor's browser would reach it) and links three IP
    // literals (never admitted). No name resolution anywhere.
    let site = fixture_site().await;
    let (ledger, output) = run_scan_with_output(&site).await;

    let allowed = ledger.allowed();
    assert!(
        allowed.iter().any(|(h, _)| h == THIRD_PARTY_HOST),
        "the named third party was not admitted: {allowed:?}"
    );
    assert!(
        output.hosts.iter().any(|h| h.host == THIRD_PARTY_HOST),
        "the named third party is missing from the site's hosts: {:?}",
        output.hosts
    );
    let denied = ledger.denied();
    for literal in FIXTURE_IP_LITERALS {
        assert!(
            denied.iter().any(|(h, _, r)| h == literal && *r == DenyReason::IpLiteral),
            "{literal} was not denied as an IP literal: {denied:?}"
        );
    }
    assert!(
        !allowed.iter().any(|(h, _)| h.parse::<IpAddr>().is_ok()),
        "an IP literal was admitted: {allowed:?}"
    );
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
/// This is an **allowlist of known, documented exceptions** — not a claim that any
/// of it is acceptable to leave unsuppressed forever. Six entries: three admitted, three denied.
/// Since spec §13 admission
/// admits any named host on 80/443, but www.gstatic.com, accounts.google.com and
/// www.google.com go through only once a page asked for them (`ASKED_FOR_ONLY_HOSTS`
/// below); this fixture never does, so here they are attempted and denied. The
/// other three — `admission::BROWSER_SERVICE_HOSTS` — are denied by name
/// (`DenyReason::BrowserService`) and must never be admitted. A host the proxy sees
/// during a scan that is **not** in this list is the finding this test exists to catch.
const KNOWN_DENIED_BROWSER_SERVICE_HOSTS: [(&str, &str); 6] = [
    (
        "safebrowsingohttpgateway.googleapis.com",
        "Safe Browsing hash-prefix lookups routed through Google's Oblivious HTTP \
         gateway — attempted by the GitHub Actions runner's Chrome (newer than the \
         locally verified 151, which never attempts it) on first navigation; no \
         --disable-features name or switch verified present for it, and the \
         historical --safebrowsing-* switches were already found absent from \
         Chrome 151 in the Task 6 audit. Admitted on 443 like every host in this \
         list, so in the product it may reach the network; the test connector \
         refuses to dial it",
    ),
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
    (
        "update.googleapis.com",
        "Chrome's updater — observed on Chrome 151+ on macOS with \
         --disable-component-update set; no switch found that suppresses the \
         attempt (intermittent); now denied by admission::decide",
    ),
];

/// Chrome's own hosts that admission refuses by name; never in the allowed ledger.
const REFUSED_BROWSER_SERVICE_HOSTS: [&str; 3] = [
    "safebrowsingohttpgateway.googleapis.com",
    "android.clients.google.com",
    "update.googleapis.com",
];

/// Google hosts Chrome reaches on its own and sites also use: `admission::asked_for_only`.
const ASKED_FOR_ONLY_HOSTS: [&str; 3] = ["www.google.com", "www.gstatic.com", "accounts.google.com"];

#[tokio::test]
async fn a_google_host_the_page_asks_for_is_reached_like_any_third_party() {
    // The other half of the gate: a site's own reCAPTCHA must still be on the map.
    let site = common::fixture_site_serving(vec![(
        "/",
        "<!doctype html><script src=\"https://www.gstatic.com/recaptcha/api.js\"></script>".into(),
    )])
    .await;
    let (ledger, output) = run_scan_with_output(&site).await;
    assert!(
        ledger.allowed().iter().any(|(h, _)| h == "www.gstatic.com"),
        "the page asked for www.gstatic.com and the proxy refused it: {:?}",
        ledger.denied()
    );
    assert!(output.hosts.iter().any(|h| h.host == "www.gstatic.com"), "{:?}", output.hosts);
    // Chrome's own contacts in the same scan stay shut.
    assert!(!ledger.allowed().iter().any(|(h, _)| h == "accounts.google.com"), "{:?}", ledger.allowed());
}

#[tokio::test]
async fn the_browsers_own_background_traffic_never_becomes_a_site_host() {
    // A component extension made requests even in a fresh profile during the
    // spike, until --disable-background-networking was passed. This test asserts
    // an allowlist-with-documented-exceptions, not a bare denylist: it is not
    // vacuous only because the fixture literals and the target host are both
    // asserted actually attempted, and any host outside the documented set fails
    // loudly by name.
    let site = fixture_site().await;
    let (ledger, output) = run_scan_with_output(&site).await;

    let denied = ledger.denied();
    let allowed = ledger.allowed();

    for literal in FIXTURE_IP_LITERALS {
        assert!(
            denied.iter().any(|(h, _, _)| h == literal),
            "the fixture's own off-site link to {literal} was never attempted — \
             the sensor check above is vacuous"
        );
    }
    assert!(
        allowed.iter().any(|(h, _)| h == &site.host),
        "the scan target itself was never contacted"
    );

    let known_hosts: Vec<&str> = KNOWN_DENIED_BROWSER_SERVICE_HOSTS
        .iter()
        .map(|(h, _)| *h)
        .collect();

    // Chrome's own requests may be admitted by the proxy now, but they are not
    // the site's: hosts come from the pages' own `Network.requestWillBeSent`
    // events, never from the ledger.
    for h in &output.hosts {
        assert!(
            !known_hosts.contains(&h.host.as_str()),
            "the browser's own service host {} was reported as a host the site contacted",
            h.host
        );
    }

    let attempted: Vec<&str> = allowed
        .iter()
        .map(|(h, _)| h.as_str())
        .chain(denied.iter().map(|(h, _, _)| h.as_str()))
        .collect();

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
    // any of these three ever reappears, admitted or denied, the flag that was
    // verified to close it has regressed or a new caller of the same host has
    // appeared.
    for forbidden in ["gvt1.com", "mtalk.google.com", "clients2.google.com"] {
        assert!(
            !attempted.contains(&forbidden),
            "{forbidden} was attempted — a flag verified to silence this host has regressed"
        );
    }

    // Admitted only once a page asked for them, and no page of this fixture does. Chrome
    // must actually have tried: if it stops, this check would pass on nothing.
    assert!(
        denied.iter().any(|(_, _, r)| *r == DenyReason::NotAskedFor),
        "Chrome made none of its own Google contacts — revisit ASKED_FOR_ONLY_HOSTS: {denied:?}"
    );
    for gated in ASKED_FOR_ONLY_HOSTS {
        assert!(
            !allowed.iter().any(|(h, _)| h == gated),
            "{gated} was admitted though no page asked for it"
        );
        assert!(
            denied.iter().filter(|(h, _, _)| h == gated).all(|(_, _, r)| *r == DenyReason::NotAskedFor),
            "{gated} was denied for a reason other than NotAskedFor"
        );
    }

    for refused in REFUSED_BROWSER_SERVICE_HOSTS {
        assert!(
            !allowed.iter().any(|(h, _)| h == refused),
            "{refused} was admitted — admission must refuse Chrome's own service hosts"
        );
        assert!(
            denied.iter().filter(|(h, _, _)| h == refused).all(|(_, _, r)| *r == DenyReason::BrowserService),
            "{refused} was denied for a reason other than BrowserService"
        );
    }

    let undocumented: Vec<&str> = attempted
        .into_iter()
        .filter(|h| {
            *h != site.host
                && *h != THIRD_PARTY_HOST
                && !FIXTURE_IP_LITERALS.contains(h)
                && !known_hosts.contains(h)
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
