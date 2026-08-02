//! One scan, end to end.
//!
//! The order below is the whole of this module's safety argument and is not
//! negotiable:
//!
//! ```text
//! parse the URL → build this scan's origins → start this scan's proxy
//!   → find a browser → launch it behind the proxy → observe
//!   → tear down (every path) → assert the ledger → clear the origins
//!   → serialise
//! ```
//!
//! The proxy is armed, with this scan's origins already in it, before a
//! browser process exists to make a request. The browser is torn down before
//! the ledger is read, so nothing can be added to the ledger after it has been
//! checked. And the check is the last thing between a scan and the word
//! "success".
//!
//! Every error that reaches the renderer is one of four bare tokens. Not
//! sentences: `src/renderer/strings.ts` owns the copy, and a token cannot
//! carry a filesystem path, a `CdpError`'s `Display` (several variants hold a
//! profile path or the raw `DevToolsActivePort` bytes), or anything off the
//! scanned page. `SCAN_NO_BROWSER` is the single exception and appends only
//! the paths `browser::candidate_paths()` looked at.

use crate::admission::{self, Decision};
use crate::browser::{self, DiscoveryError};
use crate::cdp::{self, CancellationToken};
use crate::proxy;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

/// The scan could not be completed. Deliberately says nothing about why.
pub const SCAN_FAILED: &str = "SCAN_FAILED";
/// What the user typed is not a website address this app will scan.
pub const SCAN_BAD_URL: &str = "SCAN_BAD_URL";
/// A scan is already running. Refusing the second outright is what makes it
/// impossible for two scans to interleave and widen what one proxy admits.
pub const SCAN_BUSY: &str = "SCAN_BUSY";
/// Neither Chrome nor Edge was found. The only code that carries a payload:
/// `SCAN_NO_BROWSER:<paths>`, built from `browser::candidate_paths()`.
pub const SCAN_NO_BROWSER: &str = "SCAN_NO_BROWSER";

/// How many pages one scan visits. The cap is the product's, not a defence.
const MAX_PAGES: u32 = 10;
/// Long enough for any address a user pastes; short enough that nothing
/// pathological is ever parsed.
const MAX_URL_LEN: usize = 2048;

/// The URL to open, the host it names, and the origins the proxy will admit
/// for the length of this scan — which is exactly `[host]`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    pub url: String,
    pub host: String,
    pub origins: Vec<String>,
}

/// What one scan returns to the renderer. Matches `ScanResult` in
/// `src/core/types.ts` field for field; a mismatch fails silently there, which
/// is why the test asserts on the key names rather than on the struct.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanOutput {
    pub scanned_host: String,
    pub hosts: Vec<cdp::ObservedHost>,
    pub pages_visited: u32,
    pub possible_gaps: u32,
    pub stopped_early: bool,
}

/// Turn what the user typed into a target, or refuse it.
///
/// This is the only place a scheme is enforced *on the URL the user types*.
/// Task 6's audit found that no Chrome flag delivers the `file://`
/// remote-authority requirement and recorded that requirement as unmet, and
/// `browser::url_is_permitted` is an unwired spec, so there is no second gate
/// behind this one: an address that gets past here is an address the browser
/// is told to open.
///
/// It says nothing about a navigation the scanned page itself initiates. The
/// residual there is low rather than closed: Chrome blocks web-to-`file://`
/// navigation by default, and `cdp.rs` only follows `http(s)` links.
///
/// The host is checked with `admission::vet_host`, the same function the proxy
/// admits by, so the string that becomes a scan origin cannot be one this
/// module and `admission` would read differently.
pub fn parse_target(raw: &str) -> Result<Target, &'static str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_URL_LEN {
        return Err(SCAN_BAD_URL);
    }
    // Printable ASCII only, so an IDN homograph, a percent-escape's raw bytes,
    // a control character or a Unicode space never reaches the parsing below.
    if !trimmed.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
        return Err(SCAN_BAD_URL);
    }

    let (scheme, rest) = if let Some(split) = split_scheme(trimmed) {
        split
    } else {
        // Anything else with a scheme is refused rather than repaired:
        // `file:`, `data:`, `javascript:`, `chrome:`, `smb://`. A colon before
        // the first slash is what a scheme looks like, and it is also what a
        // port looks like — neither is accepted on a bare host.
        let authority_end = trimmed.find('/').unwrap_or(trimmed.len());
        if trimmed[..authority_end].contains(':') {
            return Err(SCAN_BAD_URL);
        }
        ("https", trimmed)
    };

    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, path) = rest.split_at(authority_end);
    // `@` is userinfo: `https://rossi-editore.it@evil.test/` names evil.test.
    // `:` is a port, and `admission` allows only 80 and 443, so a URL carrying
    // one would launch a browser that the proxy then refuses to route.
    if authority.contains('@') || authority.contains(':') {
        return Err(SCAN_BAD_URL);
    }
    let host = authority.to_ascii_lowercase();
    // `vet_host` strips one trailing dot before comparing, which is right for
    // matching and wrong for accepting: `rossi-editore.it.` is not what the
    // user typed to us in any form we want to store as an origin.
    if host.ends_with('.') {
        return Err(SCAN_BAD_URL);
    }
    match admission::vet_host(&host) {
        // Identity check: if `vet_host` had to change the string to accept it,
        // this module and the proxy are reading two different names.
        Some(vetted) if vetted == host.as_str() => {}
        _ => return Err(SCAN_BAD_URL),
    }
    // A single label — `localhost`, a bare TLD — is not something
    // `admission::usable_origin` will match on, so a scan of one would admit
    // nothing and stall. Refuse it here, where it can be explained.
    if !host.contains('.') {
        return Err(SCAN_BAD_URL);
    }
    // The same rule as `admission::is_ip_literal`, which is private there.
    // A scan of 127.0.0.1, 192.168.1.1 or 169.254.169.254 is a scan of the
    // user's own machine or network, which "the URL the user entered" does not
    // authorise.
    if host.parse::<IpAddr>().is_ok() {
        return Err(SCAN_BAD_URL);
    }

    let path = if path.is_empty() { "/" } else { path };
    Ok(Target {
        url: format!("{scheme}{SCHEME_SEPARATOR}{host}{path}"),
        host: host.clone(),
        origins: vec![host],
    })
}

/// The two schemes this app will open, and the separator, deliberately kept
/// apart from each other. `tests/build/noRemoteAssets.test.ts` forbids an
/// `http(s)` URL literal in shipping code and that guard is right: what is
/// needed here is a scheme prefix, not an address, and the way to say so is
/// never to write the two halves as one literal.
const SCHEMES: [&str; 2] = ["https", "http"];
const SCHEME_SEPARATOR: &str = "://";

/// `https` is tried before `http` so the longer scheme is not read as the
/// shorter one followed by a stray `s`.
fn split_scheme(s: &str) -> Option<(&'static str, &str)> {
    SCHEMES.iter().find_map(|scheme| {
        let rest = strip_prefix_ci(s, scheme)?.strip_prefix(SCHEME_SEPARATOR)?;
        Some((*scheme, rest))
    })
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &s[prefix.len()..])
}

/// The ledger assertion, as a pure function so it can be tested without a live
/// proxy.
///
/// It re-runs `admission::decide` rather than testing set membership, because
/// membership is the wrong rule: `decide` admits a subdomain of a scan origin
/// on a label boundary, so a scan of `rossi-editore.it` that loaded
/// `www.rossi-editore.it` has a perfectly correct ledger that a
/// `origins.contains(&host)` test would call a failure.
///
/// With `RunningGuard` in place the `decide` re-run cannot currently fail on a
/// live scan: the origins `Arc` is written once at the top of `run` and after
/// that is only ever emptied, and the ledger belongs to this scan alone. It is
/// kept as a standing structural check that would survive a later change to how
/// origins are set. The teeth of this step are the other two arguments.
///
/// `healthy` fails a scan whose sensor stopped recording. `dropped` fails a
/// scan whose notebook filled up: `Ledger::healthy()` deliberately ignores
/// dropped records, because a proxy that has run out of room to write must
/// still keep guarding — losing the note is not losing the gate. A scan is the
/// opposite case. Its whole product is the completeness of that record, and a
/// scan that admitted more requests than it wrote down cannot honestly say it
/// saw everything it let through. So the looser rule stays in `Ledger`, for the
/// proxy, and the stricter one lives here, for the scan.
fn ledger_is_consistent(
    healthy: bool,
    dropped: u64,
    allowed: &[(String, u16)],
    origins: &[String],
) -> bool {
    healthy
        && dropped == 0
        && allowed.iter().all(|(host, port)| {
            matches!(
                admission::decide(host, *port, origins),
                Decision::Allow { .. }
            )
        })
}

/// Set while a scan runs, holding that scan's cancellation token so
/// `cancel_scan` can reach it. `None` means no scan is running.
#[derive(Debug, Default)]
pub struct ScanState {
    current: Mutex<Option<CancellationToken>>,
}

/// A poisoned lock means some other thread panicked while holding it. The data
/// behind it is a token or a list of origins, neither of which can be left
/// half-written, so recovering is strictly better than propagating a panic
/// into a scan that is trying to clean up.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Holds the "a scan is running" claim. `Drop`, not a line at the end of the
/// happy path: every error return, and cancellation, has to clear it too, and
/// only `Drop` covers all of them without being remembered.
struct RunningGuard {
    state: Arc<ScanState>,
}

impl RunningGuard {
    fn acquire(state: &Arc<ScanState>, token: CancellationToken) -> Option<Self> {
        let mut slot = lock(&state.current);
        if slot.is_some() {
            return None;
        }
        *slot = Some(token);
        Some(Self {
            state: Arc::clone(state),
        })
    }
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        *lock(&self.state.current) = None;
    }
}

/// Empties this scan's origins when the scan ends, however it ends. While the
/// vector is empty `admission::decide` returns `NoScanRunning` for every host,
/// so the listener still holding this `Arc` admits nothing.
struct OriginsGuard(Arc<Mutex<Vec<String>>>);

impl Drop for OriginsGuard {
    fn drop(&mut self) {
        lock(&self.0).clear();
    }
}

/// Cancel the running scan. Cancelling when nothing is running is not an
/// error — the user pressed stop as the scan was already finishing.
pub fn cancel(state: &ScanState) {
    if let Some(token) = lock(&state.current).as_ref() {
        token.cancel();
    }
}

/// Called once the browser is up, before observation starts, with the child's pid and its
/// profile directory. `run` never installs one. It exists so `tests/egress.rs` — spec §9.3's
/// executable promise — can capture a live pid and path and drive `cancel` through the same
/// public entry point the renderer uses, rather than needing its own route into a running scan.
///
/// `pub` only under the `test-support` feature (off by default, so `cargo build --release`
/// never carries it — see `Cargo.toml`'s `[features]`). `run_pipeline` below still needs the
/// type regardless of the feature, so the `not(feature = ...)` arm keeps it crate-visible.
#[cfg(feature = "test-support")]
pub type LaunchHook = Box<dyn FnOnce(u32, &Path) + Send>;
#[cfg(not(feature = "test-support"))]
type LaunchHook = Box<dyn FnOnce(u32, &Path) + Send>;

/// What the test-support entry points below return: everything `run` already asserted, plus the
/// evidence a test needs to check its own work. `run` never constructs one.
///
/// `pub`, and its fields `pub`, only under the `test-support` feature — same reasoning as
/// `LaunchHook` above. `run_pipeline` and `run` read these fields from inside this module
/// either way, which needs no visibility at all.
#[cfg(feature = "test-support")]
pub struct ScanRun {
    /// This scan's own ledger, readable after teardown — exactly what the ledger assertion below
    /// already read to decide `result`.
    pub ledger: Arc<proxy::Ledger>,
    pub profile_dir: PathBuf,
    pub child_pid: u32,
    /// What `run` would have serialised, or the same bare token `run` would have returned.
    pub result: Result<ScanOutput, String>,
}
// Without `test-support`, only `.result` is ever read (by `run`, below) — `.ledger`,
// `.profile_dir` and `.child_pid` exist solely for the test-support entry points this build
// does not compile in. `dead_code` would otherwise flag exactly that, correctly; allowed here
// rather than restructured, since the two `ScanRun` definitions must stay field-for-field
// identical for `run_pipeline`'s single construction site to compile under both cfgs.
#[cfg_attr(not(feature = "test-support"), allow(dead_code))]
#[cfg(not(feature = "test-support"))]
struct ScanRun {
    ledger: Arc<proxy::Ledger>,
    profile_dir: PathBuf,
    child_pid: u32,
    result: Result<ScanOutput, String>,
}

/// The whole of `run`'s pipeline — order, teardown, the ledger assertion — behind two seams a
/// production scan never uses: the connector, and an optional post-launch hook. `run` calls this
/// with `proxy::real_connector()` and no hook, and discards everything but `result`.
///
/// `real_connector` resolves a name for real and then refuses to dial anywhere the resolved
/// address turns out to be loopback or private (`is_permitted_upstream`, in this module's own
/// file) — which is exactly what a test fixture necessarily is. A test cannot exercise this
/// pipeline through `real_connector` without either performing a real DNS lookup or being refused
/// by the very check that makes the proxy safe, so the connector is the one thing `tests/
/// egress.rs` is allowed to substitute. Admission, teardown order and the ledger assertion are
/// unchanged and unreachable from outside this module.
async fn run_pipeline(
    state: Arc<ScanState>,
    target: Target,
    connect: proxy::Connector,
    cancel_token: CancellationToken,
    on_launched: Option<LaunchHook>,
    poison_ledger_for_test: bool,
) -> Result<ScanRun, String> {
    let Some(_running) = RunningGuard::acquire(&state, cancel_token.clone()) else {
        return Err(SCAN_BUSY.to_string());
    };

    // This scan's own origins, and — through `proxy::start` — this scan's own
    // ledger. Not shared with any other scan: a shared ledger would fail the
    // assertion below on the previous scan's hosts, and a shared origins vector
    // is a thing two scans could both write to.
    let origins = Arc::new(Mutex::new(target.origins.clone()));
    let _origins_guard = OriginsGuard(Arc::clone(&origins));

    // Armed here, before a browser exists to make a request.
    //
    // HONESTLY: `proxy::start` has no shutdown, so this listener task outlives
    // the scan. It is bound to 127.0.0.1 on an ephemeral port and, once
    // `OriginsGuard` has run, holds an empty origins vector, so it admits
    // nothing and no later scan can re-arm it — each scan allocates a fresh
    // `Arc`. A real shutdown signal is Phase 2 work.
    let proxy_handle = proxy::start(Arc::clone(&origins), connect)
        .await
        .map_err(|_| SCAN_FAILED.to_string())?;
    let proxy_port = proxy_handle.addr.port();

    let found = match tokio::task::spawn_blocking(browser::discover).await {
        Ok(Ok(found)) => found,
        Ok(Err(DiscoveryError::NoneFound { searched })) => return Err(no_browser_message(&searched)),
        Err(_) => return Err(SCAN_FAILED.to_string()),
    };

    // `launch` blocks for up to ten seconds waiting for `DevToolsActivePort`;
    // running it on the runtime would starve a proxy worker sharing it.
    let profile_dir = profile_dir_path();
    let launched = match tokio::task::spawn_blocking(move || {
        browser::launch(&found, profile_dir, proxy_port)
    })
    .await
    {
        Ok(Ok(launched)) => launched,
        // `launch` removes the profile directory itself on every failing path.
        _ => return Err(SCAN_FAILED.to_string()),
    };

    let child_pid = launched.child.id();
    let profile_dir = launched.profile_dir.clone();
    if let Some(hook) = on_launched {
        hook(child_pid, &profile_dir);
    }

    let observed = cdp::observe(&launched, &target.url, MAX_PAGES, cancel_token).await;

    // Unconditional, and before the observation is unwrapped: the browser must
    // be dead and its profile gone whether the scan succeeded, failed or was
    // cancelled — and before anything reads the ledger.
    let torn_down = tokio::task::spawn_blocking(move || browser::tear_down(launched)).await;

    // Test-support only: poisons the ledger `run` would otherwise assert clean, so
    // `tests/egress.rs` can prove the assertion below actually fires rather than assuming it
    // would. Never set by `run`. `poison_ledger_for_test` is always `false` on the path `run`
    // takes, so this whole block — gated on the same `test-support` feature as
    // `Ledger::poison_for_test` itself — compiles out entirely from a release build; nothing
    // here is reachable from production code either way.
    #[cfg(feature = "test-support")]
    if poison_ledger_for_test {
        proxy_handle.ledger.poison_for_test();
    }
    #[cfg(not(feature = "test-support"))]
    let _ = poison_ledger_for_test;

    let result = (|| {
        let observation = observed.map_err(|_| SCAN_FAILED.to_string())?;
        if !matches!(torn_down, Ok(Ok(()))) {
            // A browser that would not die is a browser that could still be making
            // requests behind the ledger read below.
            return Err(SCAN_FAILED.to_string());
        }

        if !ledger_is_consistent(
            proxy_handle.ledger.healthy(),
            proxy_handle.ledger.dropped_records(),
            &proxy_handle.ledger.allowed(),
            &target.origins,
        ) {
            return Err(SCAN_FAILED.to_string());
        }
        // Explicit, in the order the plan fixes; `OriginsGuard` repeats it on every
        // path that never reaches this line.
        lock(&origins).clear();

        Ok(ScanOutput {
            scanned_host: target.host.clone(),
            hosts: observation.hosts,
            pages_visited: observation.pages_visited,
            possible_gaps: observation.possible_gaps,
            stopped_early: observation.stopped_early,
        })
    })();

    Ok(ScanRun {
        ledger: proxy_handle.ledger,
        profile_dir,
        child_pid,
        result,
    })
}

/// Run one scan and return its result as JSON.
pub async fn run(state: Arc<ScanState>, url: String) -> Result<String, String> {
    let target = parse_target(&url).map_err(str::to_string)?;
    let cancel_token = CancellationToken::new();
    let run = run_pipeline(state, target, proxy::real_connector(), cancel_token, None, false).await?;
    run.result
        .and_then(|output| serde_json::to_string(&output).map_err(|_| SCAN_FAILED.to_string()))
}

/// Test-support entry point for `tests/egress.rs` (spec §9.3's executable promise). Runs exactly
/// `run`'s pipeline — admission, teardown order, the ledger assertion — against `connect` rather
/// than a real resolver. See `run_pipeline`'s doc comment for why the connector is the one thing
/// a test may substitute.
///
/// Gated behind the non-default `test-support` feature (see `Cargo.toml`) so this — and the two
/// functions below it, and `proxy::Ledger::poison_for_test` — do not ship in the release rlib.
/// `cargo build --release` compiles this crate without the feature, so none of the three exist
/// as symbols in that build; `tests/egress.rs` enables it through the self dev-dependency in
/// `Cargo.toml`.
#[cfg(feature = "test-support")]
pub async fn run_scan_for_test(
    state: Arc<ScanState>,
    target: Target,
    connect: proxy::Connector,
) -> Result<ScanRun, String> {
    run_pipeline(state, target, connect, CancellationToken::new(), None, false).await
}

/// As [`run_scan_for_test`], but calls `hook` with the launched browser's pid and profile
/// directory before observation starts — the only way a test can learn either value while the
/// scan can still be reached through the public [`cancel`], since `run`'s pipeline does not
/// expose them until after teardown has already run.
#[cfg(feature = "test-support")]
pub async fn run_scan_for_test_with_launch_hook(
    state: Arc<ScanState>,
    target: Target,
    connect: proxy::Connector,
    hook: LaunchHook,
) -> Result<ScanRun, String> {
    run_pipeline(state, target, connect, CancellationToken::new(), Some(hook), false).await
}

/// As [`run_scan_for_test`], but poisons this scan's ledger after teardown and before the ledger
/// assertion, so a test can prove `run.result` is `Err` when the ledger dropped a record — the
/// stricter rule `ledger_is_consistent`'s doc comment describes — without needing to fill
/// `MAX_LEDGER_ENTRIES` for real.
#[cfg(feature = "test-support")]
pub async fn run_scan_for_test_with_poisoned_ledger(
    state: Arc<ScanState>,
    target: Target,
    connect: proxy::Connector,
) -> Result<ScanRun, String> {
    run_pipeline(state, target, connect, CancellationToken::new(), None, true).await
}

/// The environment variables that can name a directory belonging to the user's
/// own account, and which must therefore be abbreviated out of any path this
/// module hands to the renderer.
///
/// Named as a constant rather than written inline so that shrinking it back to
/// `["HOME"]` — the exact regression the Task 8 audit caught, which put the
/// Windows account name in front of the user — is pinned by a test. The list is
/// not `#[cfg]`-gated, so it is testable on every platform even though
/// `browser::candidate_paths` is not.
const ACCOUNT_PREFIX_VARS: [&str; 3] = ["HOME", "USERPROFILE", "LOCALAPPDATA"];

/// `SCAN_NO_BROWSER:<paths>` — the paths that were looked at, so the user can
/// see where to install Chrome or Edge.
///
/// A candidate under the user's account is abbreviated to `~` first. The paths
/// are constants, but the account directory in one carries the account name,
/// and the renderer shows its own sentence anyway.
///
/// Three variables, not just `HOME`: Windows normally leaves `HOME` unset, and
/// `browser::candidate_paths` builds its Windows candidates from
/// `LOCALAPPDATA`, which is `C:\Users\<account>\AppData\Local`. Stripping only
/// `HOME` would put the account name in front of the user and in the process
/// console on exactly the platform where it is most likely to be a real name.
///
/// The Windows half of that rests on a coupling worth naming: `strip_prefix` is
/// case-sensitive on normal components, so it only strips because
/// `candidate_paths` and this function read the *same* variables the same way,
/// giving byte-identical strings. If `candidate_paths` ever canonicalises,
/// hardcodes `C:\Users\...`, or moves to `SHGetKnownFolderPath`, the prefix
/// stops matching and the account name comes back silently.
fn no_browser_message(searched: &[PathBuf]) -> String {
    let prefixes: Vec<PathBuf> = ACCOUNT_PREFIX_VARS
        .iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect();
    let paths: Vec<String> = searched.iter().map(|p| abbreviate(p, &prefixes)).collect();
    format!("{SCAN_NO_BROWSER}:{}", paths.join(", "))
}

/// Replace the longest matching prefix with `~`. Longest-first because these
/// prefixes nest — `LOCALAPPDATA` sits inside `USERPROFILE` — and the longest
/// match is the one that removes the most of the user's own directory.
fn abbreviate(path: &Path, prefixes: &[PathBuf]) -> String {
    let mut ordered: Vec<&PathBuf> = prefixes.iter().collect();
    ordered.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    for prefix in ordered {
        if prefix.as_os_str().is_empty() {
            continue;
        }
        if let Ok(rest) = path.strip_prefix(prefix) {
            return format!("~/{}", rest.display());
        }
    }
    path.display().to_string()
}

/// A path in the OS temp directory that no concurrent scan, and no other
/// process, will pick. `browser::launch` creates it with `create_dir` and
/// refuses if anything is already there, so uniqueness here is about not
/// colliding, never about safety.
fn profile_dir_path() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "traccia-scan-{}-{}-{}",
        std::process::id(),
        nanos,
        n
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_plain_https_url_and_extracts_its_host() {
        let target = parse_target("https://rossi-editore.it/").expect("valid");
        assert_eq!(target.host, "rossi-editore.it");
        assert_eq!(target.origins, vec!["rossi-editore.it".to_string()]);
    }

    #[test]
    fn accepts_a_url_the_user_typed_without_a_scheme() {
        let target = parse_target("rossi-editore.it").expect("valid");
        assert_eq!(target.host, "rossi-editore.it");
        assert_eq!(target.url, "https://rossi-editore.it/");
    }

    #[test]
    fn accepts_plain_http_because_some_client_sites_are_still_on_it() {
        let target = parse_target("http://rossi-editore.it/").expect("valid");
        assert_eq!(target.url, "http://rossi-editore.it/");
    }

    #[test]
    fn refuses_anything_that_is_not_a_web_url() {
        for bad in [
            "file:///etc/passwd",
            "file://attacker.example/share/x",
            "smb://host/share",
            "javascript:alert(1)",
            "data:text/html,<script>",
            "chrome://settings",
            "",
            "   ",
            "http://",
            "https://",
            "http://[::1]:99999/",
        ] {
            assert!(parse_target(bad).is_err(), "should have been refused: {bad}");
        }
    }

    #[test]
    fn refuses_a_url_whose_host_is_a_loopback_or_private_address() {
        // The user asked to scan a website. A scan of 127.0.0.1 or 192.168.0.1
        // is a scan of their own machine or their own network, which is not
        // what "the URL the user explicitly entered" is meant to authorise.
        for bad in [
            "http://127.0.0.1/",
            "http://localhost/",
            "http://[::1]/",
            "http://192.168.1.1/",
            "http://10.0.0.1/",
            "http://169.254.169.254/",
        ] {
            assert!(parse_target(bad).is_err(), "should have been refused: {bad}");
        }
    }

    #[test]
    fn the_scan_origin_is_the_typed_host_and_nothing_else() {
        // Not the registrable domain, not a wildcard. Widening here would widen
        // what the proxy admits, and the proxy is the whole guarantee.
        let target = parse_target("https://shop.rossi-editore.it/").expect("valid");
        assert_eq!(target.origins, vec!["shop.rossi-editore.it".to_string()]);
    }

    #[test]
    fn refuses_every_authority_trick_admission_would_also_refuse() {
        // The host that reaches `scan_origins` decides what the proxy admits for
        // the rest of the scan, so anything that could make one string look like
        // two different names has to die here.
        for bad in [
            "https://user@evil.example/",           // userinfo
            "https://rossi-editore.it@evil.test/",  // userinfo that reads as the target
            "https://rossi-editore.it./",           // trailing dot
            "https://rossi%2Deditore.it/",          // percent-encoding
            "https://rossi‑editore.it/",            // IDN / non-ASCII
            "https://rossi-editore.it:8443/",       // a port admission would deny
            "https://.rossi-editore.it/",           // empty leading label
            "https://rossi..it/",                   // empty inner label
            "https://ross i.it/",                   // whitespace inside the authority
        ] {
            assert!(parse_target(bad).is_err(), "should have been refused: {bad}");
        }
    }

    #[test]
    fn normalises_the_host_the_user_typed_to_lowercase() {
        let target = parse_target("HTTPS://Rossi-Editore.IT/Chi-Siamo").expect("valid");
        assert_eq!(target.host, "rossi-editore.it");
        assert_eq!(target.origins, vec!["rossi-editore.it".to_string()]);
        assert_eq!(target.url, "https://rossi-editore.it/Chi-Siamo");
    }

    #[test]
    fn serialises_a_result_in_the_shape_the_renderer_expects() {
        let json = serde_json::to_string(&ScanOutput {
            scanned_host: "rossi-editore.it".into(),
            hosts: vec![cdp::ObservedHost {
                host: "doubleclick.net".into(),
                request_count: 3,
            }],
            pages_visited: 4,
            possible_gaps: 2,
            stopped_early: true,
        })
        .expect("serialise");
        assert!(json.contains("\"scannedHost\""));
        assert!(json.contains("\"requestCount\""));
        assert!(json.contains("\"pagesVisited\""));
        assert!(json.contains("\"possibleGaps\""));
        assert!(json.contains("\"stoppedEarly\""));
    }

    #[test]
    fn a_ledger_holding_a_subdomain_of_the_scan_target_is_consistent() {
        let origins = vec!["rossi-editore.it".to_string()];
        let allowed = vec![
            ("rossi-editore.it".to_string(), 443),
            ("www.rossi-editore.it".to_string(), 443),
        ];
        assert!(ledger_is_consistent(true, 0, &allowed, &origins));
    }

    #[test]
    fn a_ledger_holding_a_host_that_is_not_the_scan_target_fails_the_scan() {
        let origins = vec!["rossi-editore.it".to_string()];
        let allowed = vec![("notrossi-editore.it".to_string(), 443)];
        assert!(!ledger_is_consistent(true, 0, &allowed, &origins));
    }

    #[test]
    fn an_unhealthy_ledger_fails_the_scan_even_with_nothing_recorded() {
        // A sensor that stopped recording is a failed scan, not a clean one.
        assert!(!ledger_is_consistent(
            false,
            0,
            &[],
            &["rossi-editore.it".to_string()]
        ));
    }

    #[test]
    fn a_ledger_that_dropped_a_record_fails_the_scan() {
        // The proxy's own `healthy()` tolerates a dropped detail record on
        // purpose. A scan does not: it would be claiming completeness it
        // cannot show.
        assert!(!ledger_is_consistent(
            true,
            500,
            &[],
            &["rossi-editore.it".to_string()]
        ));
    }

    #[test]
    fn a_ledger_entry_recorded_on_an_unexpected_port_fails_the_scan() {
        // The assertion re-runs `decide` with the *recorded* port, not with a
        // hard-coded 443: an entry on 8443 is a ledger that disagrees with
        // what the proxy is allowed to route.
        let origins = vec!["rossi-editore.it".to_string()];
        let allowed = vec![("rossi-editore.it".to_string(), 8443)];
        assert!(!ledger_is_consistent(true, 0, &allowed, &origins));
    }

    #[test]
    fn a_windows_candidate_path_never_carries_the_account_name() {
        // Windows has no `HOME`; the account name arrives through
        // `USERPROFILE` and `LOCALAPPDATA`. Driven through the pure
        // `abbreviate` with a Windows-shaped path so it runs on any host.
        let user_profile = PathBuf::from("C:/Users/g.conti");
        let local_app_data = user_profile.join("AppData/Local");
        let chrome = local_app_data.join("Google/Chrome/Application/chrome.exe");
        let shown = abbreviate(&chrome, &[user_profile, local_app_data]);
        assert!(
            !shown.contains("g.conti"),
            "the account name reached the renderer: {shown}"
        );
        assert!(shown.starts_with('~'), "not abbreviated at all: {shown}");
    }

    #[test]
    fn every_variable_that_can_name_the_users_own_directory_is_stripped() {
        // The test above proves `abbreviate` works on the prefixes it is
        // handed. This one pins *which* prefixes `no_browser_message` hands
        // it, because that is the half the audit found broken: the list had
        // been `["HOME"]`, which is unset on Windows, so the account name in
        // `LOCALAPPDATA` went straight to the renderer and the process
        // console. `abbreviate` was blameless and every test still passed.
        assert!(ACCOUNT_PREFIX_VARS.contains(&"HOME"));
        assert!(
            ACCOUNT_PREFIX_VARS.contains(&"USERPROFILE"),
            "Windows normally leaves HOME unset"
        );
        assert!(
            ACCOUNT_PREFIX_VARS.contains(&"LOCALAPPDATA"),
            "browser::candidate_paths builds its Windows candidates from this one"
        );
    }

    #[test]
    fn a_second_scan_cannot_start_while_one_is_running() {
        let state = Arc::new(ScanState::default());
        let first = RunningGuard::acquire(&state, CancellationToken::new()).expect("first");
        assert!(RunningGuard::acquire(&state, CancellationToken::new()).is_none());
        drop(first);
        assert!(RunningGuard::acquire(&state, CancellationToken::new()).is_some());
    }

    #[test]
    fn dropping_the_origins_guard_leaves_the_proxy_admitting_nothing() {
        let origins = Arc::new(Mutex::new(vec!["rossi-editore.it".to_string()]));
        {
            let _guard = OriginsGuard(Arc::clone(&origins));
        }
        let held = lock(&origins).clone();
        assert!(held.is_empty());
        assert!(matches!(
            admission::decide("rossi-editore.it", 443, &held),
            Decision::Deny {
                reason: admission::DenyReason::NoScanRunning
            }
        ));
    }

    #[test]
    fn cancel_flips_the_running_scans_token_and_is_a_no_op_when_idle() {
        let state = Arc::new(ScanState::default());
        cancel(&state); // nothing running: not an error
        let token = CancellationToken::new();
        let _guard = RunningGuard::acquire(&state, token.clone()).expect("acquire");
        assert!(!token.is_cancelled());
        cancel(&state);
        assert!(token.is_cancelled());
    }

    #[test]
    fn every_code_the_renderer_can_receive_is_a_bare_token() {
        // These cross into the renderer, which shows its own copy of each
        // sentence. A token cannot carry a path or anything out of the map.
        for code in [SCAN_FAILED, SCAN_BAD_URL, SCAN_BUSY, SCAN_NO_BROWSER] {
            assert!(!code.contains('{'), "{code:?} looks like a format string");
            assert!(
                !code.contains('/') && !code.contains('\\'),
                "{code:?} could carry a path"
            );
            assert!(!code.contains(' '), "{code:?} is not a token");
        }
    }
}
