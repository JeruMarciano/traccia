//! Finding a Chromium-family browser already installed on the machine.
//!
//! Chrome first, then Edge. Edge ships with every Windows 10/11 install, so it
//! is the guaranteed hit that makes Windows work at all; Chrome covers macOS
//! and most Windows machines. Brave is deliberately absent: its built-in
//! blocker removes trackers before Traccia can observe them, so a Brave scan
//! reports a clean site that is not clean — a wrong answer, and the dangerous
//! direction for this tool.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Browser {
    Chrome,
    Edge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub browser: Browser,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscoveryError {
    /// Carries every path that was looked at, so the message can name them.
    NoneFound { searched: Vec<PathBuf> },
}

#[cfg(target_os = "macos")]
pub fn candidate_paths() -> Vec<(Browser, PathBuf)> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut out = vec![
        (
            Browser::Chrome,
            PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ),
    ];
    if let Some(h) = home.as_ref() {
        out.push((
            Browser::Chrome,
            h.join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        ));
    }
    out.push((
        Browser::Edge,
        PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ));
    if let Some(h) = home.as_ref() {
        out.push((
            Browser::Edge,
            h.join("Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        ));
    }
    out
}

#[cfg(target_os = "windows")]
pub fn candidate_paths() -> Vec<(Browser, PathBuf)> {
    let mut out = Vec::new();
    for var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
            out.push((
                Browser::Chrome,
                base.join(r"Google\Chrome\Application\chrome.exe"),
            ));
        }
    }
    for var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
            out.push((
                Browser::Edge,
                base.join(r"Microsoft\Edge\Application\msedge.exe"),
            ));
        }
    }
    out
}

pub fn discover() -> Result<Found, DiscoveryError> {
    discover_in(&candidate_paths())
}

/// Split out so tests can drive it with paths they control. Never resolves a
/// name and never executes anything — it only asks whether a file is there.
fn discover_in(candidates: &[(Browser, PathBuf)]) -> Result<Found, DiscoveryError> {
    for (browser, path) in candidates {
        if is_executable_file(path) {
            return Ok(Found {
                browser: *browser,
                path: path.clone(),
            });
        }
    }
    Err(DiscoveryError::NoneFound {
        searched: candidate_paths().iter().map(|(_, p)| p.clone()).collect(),
    })
}

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

/// A launched browser process, driving an ephemeral profile.
///
/// `devtools_port` is the port Chrome chose after being told
/// `--remote-debugging-port=0` and is only known once `DevToolsActivePort`
/// appears in `profile_dir` — `launch` blocks (bounded by
/// [`DEVTOOLS_READY_TIMEOUT`]) until that happens or the process exits.
pub struct Launched {
    pub child: Child,
    pub profile_dir: PathBuf,
    pub devtools_port: u16,
}

#[derive(Debug)]
pub enum LaunchError {
    /// `std::fs::create_dir` refused. Deliberately not `create_dir_all` and
    /// deliberately not "remove and recreate": if anything is already at
    /// this path — a stray file, a leftover directory, or a symlink planted
    /// by another local process hoping the browser will follow it and write
    /// into somewhere it does not own — `create_dir` fails without ever
    /// resolving the symlink, and launch stops here instead of handing a
    /// hostile path to the browser.
    ProfileDirExists(PathBuf, std::io::Error),
    /// `create_dir` succeeded but restricting its permissions to owner-only
    /// (0700) failed. `DevToolsActivePort`'s target GUID is the only secret
    /// protecting the debugging endpoint; a world- or group-readable
    /// profile directory would let another local account read it and drive
    /// the browser.
    ProfileDirPermissions(PathBuf, std::io::Error),
    Spawn(std::io::Error),
    /// The child process exited before it ever wrote `DevToolsActivePort`.
    /// `code` is `None` when the process was killed by a signal rather than
    /// exiting normally.
    ProcessExitedBeforeReady { code: Option<i32> },
    /// `DevToolsActivePort` never appeared within the timeout. The process
    /// is still running at this point; the caller is expected to kill it.
    DevToolsPortTimeout,
    DevToolsPortUnreadable(std::io::Error),
    DevToolsPortMalformed(String),
    ProfileCleanup(std::io::Error),
}

/// Bound on how long `launch` waits for Chrome to write
/// `DevToolsActivePort` before giving up. Generous relative to a normal
/// headless start (well under a second on this machine) so a slow CI runner
/// does not produce a false failure, but finite so a browser that never
/// opens its debugging port cannot hang the caller forever.
// Thirty seconds, not ten: a cold Chrome on a loaded Windows machine (observed on the
// GitHub Actions runner) can take longer than ten to write DevToolsActivePort. The wait
// still ends the moment the file appears or the process dies; only the failure case
// waits this long.
const DEVTOOLS_READY_TIMEOUT: Duration = Duration::from_secs(30);
const DEVTOOLS_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Right after `kill()`, a child's own children (e.g. Chrome's renderer
/// processes) can still hold open handles into the profile directory for a
/// short window — `Child::wait` only reaps the immediate child, not its
/// descendants. Most sharply on Windows, where an open handle blocks
/// deletion outright rather than merely racing it. A short retry absorbs
/// that window instead of turning a normal teardown into a reported error.
const PROFILE_REMOVE_RETRIES: u32 = 5;
const PROFILE_REMOVE_RETRY_DELAY: Duration = Duration::from_millis(100);

/// The flags every launch carries. Grouped by what each closes, since a flag
/// list is a security surface, not configuration — every entry here must be
/// able to say what it prevents, and every claim below has been checked
/// against the switch table of the pinned browser (Chrome 151.0.7922.72,
/// verified 2026-08-02 by extracting string literals from the installed
/// `Google Chrome Framework` binary), not merely against memory of what
/// Chromium switches are usually called. Four flags this project tried and
/// removed after that check — `--force-webrtc-ip-handling-policy=…`,
/// `--dns-prefetch-disable`, and two Safe Browsing/phishing companions —
/// are recorded further down as history, so the next person does not
/// reintroduce a no-op believing it still exists.
///
/// **The structural point worth carrying in this comment:** the proxy
/// itself is the enforcement point for every TCP/HTTP(S) category by
/// construction — anything dialled through `--proxy-server` is subject to
/// the same admission decision as anything else. Flags in this list are
/// load-bearing only for what the proxy cannot see at all: QUIC, WebRTC's
/// UDP path, and (unresolved — see [`url_is_permitted`]) `file://`/SMB.
/// Everything below the "background services" heading is defence in depth,
/// not the guarantee.
///
/// Ephemeral profile and required-by-brief flags:
/// - `--headless=new` — no window, no UI-driven surfaces (translate
///   infobar, first-run tour, NTP) that only exist to be clicked.
/// - `--no-first-run` / `--no-default-browser-check` — skip the first-run
///   flow and the "set as default" prompt, both of which are UI dead ends
///   in headless mode and one of which (first-run) can itself fetch promo
///   content.
/// - `--user-data-dir=<profile_dir>` — the ephemeral profile. Never the
///   user's real one; never reused between scans. Note: the runtime value
///   passed to the process is built separately in [`launch`] as an
///   `OsString`, not from this function's `String` output — see the doc
///   comment there for why.
/// - `--remote-debugging-port=0` — let the OS pick a free port rather than
///   a fixed one, which avoids silently attaching to something else already
///   listening on a hardcoded port. Chrome writes the chosen port to
///   `DevToolsActivePort` in `profile_dir`.
///
/// Proxy routing and the two real non-TCP closures — the load-bearing set,
/// since the proxy cannot see either category on its own:
/// - `--proxy-server=http://127.0.0.1:<proxy_port>` — send every HTTP/HTTPS
///   request through the loopback proxy.
/// - `--proxy-bypass-list=<-loopback>` — Chromium's *implicit* proxy bypass
///   (undocumented on the command line, present in its bypass-rules parser)
///   covers loopback and link-local addresses, not RFC 1918 space at large.
///   This negates the loopback half of that default, so a scan target that
///   happens to resolve to 127.0.0.1 still goes through the one thing that
///   enforces admission instead of connecting directly.
/// - `--disable-quic` — QUIC is UDP-based HTTP/3. `--proxy-server` only
///   routes HTTP(S) proxying for TCP; a QUIC connection can be negotiated
///   straight to the origin over UDP, bypassing the proxy entirely. This
///   forces everything onto TCP, where the proxy is the only path out.
/// - `--webrtc-ip-handling-policy=disable_non_proxied_udp` — WebRTC
///   ICE/STUN/TURN is UDP and has no relationship to the configured HTTP
///   proxy at all; a page that opens an `RTCPeerConnection` — including one
///   pointed at an attacker-controlled STUN/TURN server — would otherwise
///   reach the network directly and unrecorded. This forces WebRTC onto the
///   proxy or nothing, and closes the mDNS-candidate side effect
///   (`WebRtcHideLocalIpsWithMdns` emitting LAN multicast for ICE
///   candidates) along with it, since no non-proxied UDP means no
///   multicast either. **Note the switch name has no `force-` prefix** —
///   `--force-webrtc-ip-handling-policy` does not exist in the pinned
///   browser and was silently ignored when this project first shipped it.
///
/// Browser-side speculative DNS resolution is a real, open category: the
/// proxy cannot see it because it never becomes a connection. No verified
/// current switch for it was found in the pinned browser's table (the
/// once-assumed `--dns-prefetch-disable` is not present) — recorded here as
/// unmet rather than guessed at.
///
/// Background services — defence in depth. Any of these that did fire would
/// still be dialled through the same proxy and refused by the same
/// admission decision as anything else not the scan target, so this group
/// does not protect the no-egress promise by itself; it exists to keep a
/// scan's proxy ledger free of noise from the browser's own housekeeping.
/// Safe Browsing and client-side phishing detection are deliberately absent
/// from the flag list below, for the same reason: their traffic is HTTPS,
/// which the proxy already refuses for a non-scan-target host, and the two
/// switches this project once carried for them
/// (`--disable-client-side-phishing-detection`,
/// `--safebrowsing-disable-auto-update`) do not exist in the pinned
/// browser — they would have been dead strings claiming a closure the
/// proxy was already providing.
/// - `--disable-background-networking` — Chromium's own umbrella flag for
///   this category (variations/field-trial checks, extension update pings,
///   parts of Safe Browsing, UMA).
/// - `--disable-component-update` — no component updater fetches (e.g. the
///   Certificate Transparency log list, Widevine).
/// - `--disable-sync` — no Chrome Sync handshake.
/// - `--disable-extensions` / `--disable-default-apps` — nothing loads into
///   the fresh profile that could itself carry a network-reaching
///   component; belt and braces alongside the profile being empty.
/// - `--disable-breakpad` — no crash reporter process, so no crash-upload
///   traffic on a crash.
/// - `--disable-domain-reliability` — no periodic network-quality beacon
///   upload.
/// - `--no-pings` — disables the `<a ping>` hyperlink-auditing beacon,
///   which a scanned page's own links could otherwise fire silently on
///   click simulation.
/// - `--disable-features=…` — a feature-level closure of adjacent
///   categories, each name verified present in the pinned browser's table:
///   `Translate` (translate service), `MediaRouter` and
///   `DialMediaRouteProvider` (local-network device discovery — mDNS/SSDP/
///   DIAL — its own UDP-based bypass class distinct from WebRTC),
///   `OptimizationHints` (heuristics fetches), `AutofillServerCommunication`
///   (autofill's phone-home to Google), `DnsOverHttpsUpgrade` (Secure DNS;
///   note the real name carries an `Upgrade` suffix this project's first
///   attempt, `DnsOverHttps`, lacked). Three names this project previously
///   carried here — `OptimizationGuideModelDownloading`,
///   `OptimizationHintsFetching`, `CertificateTransparencyComponentUpdater`
///   — do not exist in the pinned browser and were removed rather than left
///   as dead strings. A sixth name, `NetworkTimeServiceQuerying`, was added
///   after `tests/egress.rs` caught a real gap this list left open:
///   Chrome's `NetworkTimeTracker` makes a plain-HTTP (port 80, not 443 —
///   deliberately, so it is unaffected by a clock skewed enough to break
///   TLS validation) request to `http://clients2.google.com/time/1/current`
///   on launch, to sanity-check the system clock ahead of certificate-
///   validity checks. None of the flags above stop it, and the admission
///   decision denies the connection attempt (it is not the scan target)
///   rather than preventing the attempt from being made, exactly the gap
///   this flag group exists to close. Verified present as the literal
///   string `NetworkTimeServiceQuerying` in the pinned browser's binary —
///   its `base::Feature` name, matching Chromium's
///   `network_time_tracker.cc` — the same verification standard as every
///   other name in this list. Two more, `PreconnectToSearch` and
///   `PreconnectToSearchDesktop`, were added after a security-audit
///   instrumented run of `tests/egress.rs` showed 12 repeated denied
///   attempts to `www.google.com:443` in one scan — `SearchEnginePreconnector`
///   (the file `navigation_predictor/search_engine_preconnector.cc` is
///   present in the pinned binary) periodically preconnects to the default
///   search engine while the browser is idle. Adding both names is a
///   **verified partial fix, not a closure**: the same instrumented ledger
///   read, repeated three times, went from 12 attempts to a stable 5 —
///   real and reproducible, but not zero. The remaining, still-open gap,
///   recorded here rather than silently dropped: a scan's denied ledger
///   still shows `www.google.com:443` (~5×), `accounts.google.com:443`
///   (2×, almost certainly `AccountReconcilor`'s unconditional GAIA
///   `ListAccounts` check — signin/account-consistency infrastructure that
///   runs on profile startup independent of any signed-in account),
///   `android.clients.google.com:443` (1×, almost certainly the legacy GCM
///   checkin endpoint, used by browser-level `GCMProfileService` regardless
///   of which feature ultimately consumes it), and `www.gstatic.com:443`
///   (1×, host also used for the same connectivity-check/search-choice
///   family of requests). None of these four is stopped by any of the
///   flags above. Candidates tried and rejected because they measurably
///   did nothing to this ledger, confirmed by the same instrumented
///   run — `--enable-features=NavigationPredictorPreconnectHoldback`,
///   `--disable-search-engine-choice-screen`, `--enable-automation` — are
///   deliberately **not** in the list below: adding a flag that does not
///   move the needle would be exactly the "verified present in a string
///   table, unverified in effect" failure mode this file's own history
///   (Task 6, then the `NetworkTimeServiceQuerying` addendum) already
///   warns against. No `--disable-features=` name for GAIA account
///   reconciliation or GCM checkin was found searched for in the pinned
///   binary's string table under any of the naming patterns Chromium uses
///   for comparable subsystems (`account-consistency`, `AccountReconcilor`,
///   `GCM*`, `checkin`). This remains open, tracked by the security-audit
///   ledger evidence rather than by a comment claiming a closure that was
///   not verified.
///
/// **A second, bounded suppression attempt** (controller-directed) tried
/// `--metrics-recording-only`, `--use-mock-keychain`, `--mute-audio`,
/// `--disable-hang-monitor`, `--disable-prompt-on-repost`, and
/// `AvoidAutoTriggerListAccountsOnStale` (the one plausibly-relevant feature
/// name found searching the pinned binary's string table for
/// `ListAccounts`/`checkin`-adjacent patterns). Five of these six are
/// verified present in Chrome 151.0.7922.72; `--password-store=basic` is
/// not — its literal string is absent from the macOS binary entirely (it
/// selects a Linux keyring backend and appears to be compiled out on this
/// platform), so it is not shipped, on the same "verified present" standard
/// as everything else in this list. Of the five that are present, an
/// instrumented, repeated ledger read (identical method to the
/// `PreconnectToSearch` measurement above) showed **zero change** to the
/// denied set from any of them, alone or combined — the residual four-host
/// group below is unaffected by all five. Only `--use-mock-keychain` is
/// shipped anyway: it suppresses a macOS Keychain-access prompt in a
/// headless, non-interactive launch, which is a real problem distinct from
/// egress, so it earns its place on that basis and not on any ledger
/// effect — recorded honestly rather than implied to close a gap it does
/// not touch. The other four, including `AvoidAutoTriggerListAccountsOnStale`,
/// are not shipped: verified present, verified to do nothing to this
/// ledger, so keeping them would be exactly the no-op-as-protection failure
/// mode this file's own history (Task 6) already removed once.
///
/// **Status for the Task 13 handover:** the residual four hosts
/// (`www.gstatic.com`, `accounts.google.com`, `www.google.com`,
/// `android.clients.google.com`) are *attempted and denied* — distinct from
/// *unverified* — every one of them reaches the proxy and is refused by the
/// same admission decision as anything else that is not the scan target, so
/// nothing leaves the machine. What remains unsuppressed, after two
/// genuine, evidence-based search rounds, is the *attempt itself*.
/// `tests/egress.rs`'s `KNOWN_DENIED_BROWSER_SERVICE_HOSTS` carries the
/// same four hosts with the same per-host reasoning, asserted as the
/// exhaustive documented-exception list rather than silently tolerated.
pub fn launch_flags(profile_dir: &Path, proxy_port: u16) -> Vec<String> {
    vec![
        "--headless=new".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--disable-background-networking".to_string(),
        "--disable-component-update".to_string(),
        "--disable-sync".to_string(),
        "--disable-extensions".to_string(),
        "--disable-default-apps".to_string(),
        "--disable-breakpad".to_string(),
        "--disable-domain-reliability".to_string(),
        "--no-pings".to_string(),
        "--disable-quic".to_string(),
        "--webrtc-ip-handling-policy=disable_non_proxied_udp".to_string(),
        "--use-mock-keychain".to_string(),
        "--disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,\
         AutofillServerCommunication,DnsOverHttpsUpgrade,NetworkTimeServiceQuerying,\
         PreconnectToSearch,PreconnectToSearchDesktop"
            .to_string(),
        format!("--proxy-server=http://127.0.0.1:{proxy_port}"),
        "--proxy-bypass-list=<-loopback>".to_string(),
        format!("--user-data-dir={}", profile_dir.display()),
        "--remote-debugging-port=0".to_string(),
    ]
}

/// The specification of the `file://` remote-authority requirement carried
/// forward from Phase 1 (§1 of `docs/decisions/2026-07-31-admission-audit.md`):
/// a `file://` URL naming a remote authority must be denied — it is an SMB
/// fetch, not a fetch of the thing the user asked to scan — while a local
/// `file://` and every other local scheme (`devtools:`, `data:`, `blob:`,
/// `chrome-extension:`) must still work.
///
/// ENFORCEMENT DECISION, recorded here rather than only in the task report
/// so it cannot be quietly lost: **this requirement is not met by a launch
/// flag today.** Candidate 1 from the brief — a command-line switch that
/// denies a remote `file://` authority while leaving local `file://`,
/// `data:`, `blob:`, `devtools:` and `chrome-extension:` untouched — was
/// looked for and not found with any confidence in the pinned Chromium/Edge
/// switches. A guessed `--disable-features=` name could not be verified
/// without launching a real browser, which Global Constraints forbid in a
/// test; asserting one anyway would be a comment claiming enforcement, not
/// enforcement, which is exactly what this function exists to stop. This
/// falls to candidate 3: recorded plainly as unmet, with the mechanism
/// attempted and why it was not taken. Candidate 2 — CDP request
/// interception in Task 7 — remains available there as defence in depth on
/// top of the proxy, not as the guarantee itself.
///
/// This function is the executable specification only: it is not wired to
/// any enforcement point in this task. It stays so a future mechanism has
/// something to be tested against.
pub fn url_is_permitted(url: &str) -> bool {
    let Some((scheme, rest)) = url.split_once(':') else {
        return true;
    };
    if !scheme.eq_ignore_ascii_case("file") {
        // The proxy audit already accepted `HTTP://` on the same reasoning:
        // a scheme is case-insensitive per RFC 3986 §3.1 and its spelling
        // cannot change which authority is named. `File://attacker.example`
        // must be judged exactly as `file://attacker.example` is.
        return true;
    }
    // Windows treats '\' interchangeably with '/' in a UNC-style authority,
    // so a backslash inside what looks like a file:// path is normalised
    // before counting delimiters — `file:///\\host\share` must be judged
    // the same as `file:////host/share`.
    let normalised: String = rest.chars().map(|c| if c == '\\' { '/' } else { c }).collect();
    let leading_slashes = normalised.chars().take_while(|&c| c == '/').count();
    if leading_slashes >= 4 {
        // No legitimate local file:// URL has this many leading slashes.
        // This is how a leniently-parsing OS (Windows) reads a "double
        // slash" authority buried inside what looks like an absolute path —
        // a UNC / SMB fetch wearing a file:// costume.
        return false;
    }
    if leading_slashes != 2 {
        // Three is the standard empty-authority local form
        // (file:///path). Fewer than two means no authority component was
        // ever introduced at all (file:/path, file:path). Both are local by
        // construction — there is nowhere in either shape for a remote
        // authority to live.
        return true;
    }
    // Exactly two: file://<authority>/path.
    let after = &normalised[leading_slashes..];
    let authority = after.split(['/', '?', '#']).next().unwrap_or("");
    authority.is_empty() || authority.eq_ignore_ascii_case("localhost")
}

/// Removes the profile directory tree. "Not found" is success: teardown
/// runs on the failure path too, where the directory may never have been
/// created, and must not turn one failure into two.
pub fn remove_profile(profile_dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(profile_dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Creates the profile directory without following anything already at that
/// path, then restricts it to owner-only. See
/// [`LaunchError::ProfileDirExists`] for why `create_dir` (never
/// `create_dir_all`, never remove-and-recreate) is the point, and
/// [`LaunchError::ProfileDirPermissions`] for why the permissions matter:
/// `DevToolsActivePort`, written inside this directory, holds the only
/// secret protecting the debugging endpoint.
fn create_profile_dir(profile_dir: &Path) -> Result<(), LaunchError> {
    std::fs::create_dir(profile_dir)
        .map_err(|e| LaunchError::ProfileDirExists(profile_dir.to_path_buf(), e))?;
    restrict_to_owner(profile_dir)
}

#[cfg(unix)]
fn restrict_to_owner(profile_dir: &Path) -> Result<(), LaunchError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(profile_dir, std::fs::Permissions::from_mode(0o700))
        .map_err(|e| LaunchError::ProfileDirPermissions(profile_dir.to_path_buf(), e))
}

#[cfg(not(unix))]
fn restrict_to_owner(_profile_dir: &Path) -> Result<(), LaunchError> {
    // Windows secures a directory through an ACL, not a mode bit; this is
    // not addressed by this task and is an open item for the Windows build.
    Ok(())
}

/// Wraps [`remove_profile`] with a short bounded retry. Immediately after
/// `kill()`, a child's own descendants (e.g. Chrome's renderer processes)
/// can still hold handles into the profile directory for a brief window,
/// most sharply on Windows where an open handle blocks deletion outright.
fn remove_profile_with_retry(profile_dir: &Path) -> std::io::Result<()> {
    let mut attempt = 0;
    loop {
        match remove_profile(profile_dir) {
            Ok(()) => return Ok(()),
            Err(e) => {
                attempt += 1;
                if attempt >= PROFILE_REMOVE_RETRIES {
                    return Err(e);
                }
                std::thread::sleep(PROFILE_REMOVE_RETRY_DELAY);
            }
        }
    }
}

/// The first line of `DevToolsActivePort` is the port number; the rest of
/// the file (a second line carrying the browser target id) is not needed
/// here.
fn parse_devtools_port(contents: &str) -> Result<u16, LaunchError> {
    contents
        .lines()
        .next()
        .and_then(|line| line.trim().parse::<u16>().ok())
        .ok_or_else(|| LaunchError::DevToolsPortMalformed(contents.to_string()))
}

/// Polls for `DevToolsActivePort` to appear in `profile_dir`, bailing out
/// early — rather than waiting out the full timeout — the moment the child
/// has exited, since a dead process will never write the file.
fn wait_for_devtools_port(
    child: &mut Child,
    profile_dir: &Path,
    timeout: Duration,
) -> Result<u16, LaunchError> {
    let deadline = Instant::now() + timeout;
    let port_file = profile_dir.join("DevToolsActivePort");
    // The last thing that went wrong, reported only if the deadline passes. A file that is
    // mid-write is indistinguishable from a broken one until Chrome finishes: on Windows a
    // read during the write fails with a sharing violation (os error 32, observed on the
    // GitHub Actions runner), and a read between creation and content can parse as
    // malformed. Both are "not ready yet", not verdicts — the only immediate exits are
    // success and a dead child.
    let mut last_error: Option<LaunchError> = None;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(LaunchError::ProcessExitedBeforeReady {
                code: status.code(),
            });
        }
        match std::fs::read_to_string(&port_file) {
            Ok(contents) => match parse_devtools_port(&contents) {
                Ok(port) => return Ok(port),
                Err(e) => last_error = Some(e),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => last_error = Some(LaunchError::DevToolsPortUnreadable(e)),
        }
        if Instant::now() >= deadline {
            return Err(last_error.unwrap_or(LaunchError::DevToolsPortTimeout));
        }
        std::thread::sleep(DEVTOOLS_POLL_INTERVAL);
    }
}

/// Launches `found` against a fresh `profile_dir`, routed through the proxy
/// listening on `proxy_port`. Blocks until the browser's debugging port is
/// known or a failure is certain (see [`LaunchError`]); on any failure after
/// spawn the child is killed and the profile directory is removed before
/// returning, so a failed launch never leaks a running process or a stray
/// directory.
///
/// **Blocking, deliberately.** `wait_for_devtools_port` sleeps in a loop on
/// the calling thread for up to [`DEVTOOLS_READY_TIMEOUT`]. If the caller is
/// itself running inside an async runtime (as Task 8 will be, alongside the
/// proxy's `tokio` tasks), it **must** call this via `spawn_blocking` or
/// equivalent — calling it directly from an async task would stall whatever
/// executor thread it landed on for up to ten seconds in the worst case, and
/// starve a proxy worker sharing that runtime.
///
/// The `--user-data-dir` argument is built here as an `OsString`, not taken
/// from [`launch_flags`]'s `String` output: `Path::display()` is lossy for a
/// non-UTF-8 path (replaces unrepresentable bytes), which would tell the
/// browser to use a directory subtly different from the one `create_dir`
/// and `remove_dir_all` operate on — a failure mode that leaves the
/// scanned site's cookies on disk under a name nothing ever cleans up.
pub fn launch(found: &Found, profile_dir: PathBuf, proxy_port: u16) -> Result<Launched, LaunchError> {
    create_profile_dir(&profile_dir)?;

    let flags = launch_flags(&profile_dir, proxy_port);
    let mut user_data_dir_arg = std::ffi::OsString::from("--user-data-dir=");
    user_data_dir_arg.push(profile_dir.as_os_str());

    let mut command = Command::new(&found.path);
    for flag in &flags {
        if flag.starts_with("--user-data-dir=") {
            command.arg(&user_data_dir_arg);
        } else {
            command.arg(flag);
        }
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            let _ = remove_profile_with_retry(&profile_dir);
            return Err(LaunchError::Spawn(e));
        }
    };

    match wait_for_devtools_port(&mut child, &profile_dir, DEVTOOLS_READY_TIMEOUT) {
        Ok(devtools_port) => Ok(Launched {
            child,
            profile_dir,
            devtools_port,
        }),
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            let _ = remove_profile_with_retry(&profile_dir);
            Err(e)
        }
    }
}

impl Launched {
    /// Kills the process and waits on it, ignoring both errors: `kill` errors
    /// if the process had already exited on its own, and neither error is
    /// actionable by a caller that is itself tearing things down. Shared by
    /// `Drop` and [`tear_down`] so the two cannot drift apart.
    fn kill_and_wait(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Kills the process and removes the ephemeral profile if a `Launched` is
/// ever dropped without going through [`tear_down`] — an early return (the
/// `?` paths) or normal scope exit, including cancellation. `std::process::
/// Child`'s own `Drop` deliberately does not kill the process, so without
/// this those paths would leave the browser running.
///
/// This does **not** cover everything that can end the process early. The release profile
/// is `panic = "unwind"` (v0.2 security audit Finding 1), specifically so that a panic in
/// the caller *does* unwind through this scope and run this `Drop` — but `std::process::
/// exit` still runs no destructors, and neither does a hard `abort()` (e.g. a double panic,
/// or Rust's own guard against unwinding across an FFI boundary). In either of those cases
/// what is actually left behind is an orphaned headless Chrome whose only egress path is
/// `--proxy-server=http://127.0.0.1:<port>` pointing at a proxy that died with the process,
/// with QUIC and non-proxied UDP already disabled — so it cannot reach the network — but
/// whose ephemeral profile, holding the scanned site's cookies, sits in a 0700 temp
/// directory that nothing removes.
///
/// Errors here are unobservable — `Drop::drop` cannot return a `Result` —
/// so cleanup is best-effort; `tear_down` remains the path that can report
/// a failure to the caller.
impl Drop for Launched {
    fn drop(&mut self) {
        self.kill_and_wait();
        let _ = remove_profile_with_retry(&self.profile_dir);
    }
}

/// Tears down a launched browser: kills the process (ignoring the error if
/// it had already exited on its own) and removes the ephemeral profile.
/// Called on every path — success, failure and cancellation alike. `Drop`
/// (above) repeats this best-effort when `launched` goes out of scope at
/// the end of this function, which is redundant but harmless: killing an
/// already-reaped child is a no-op error that is ignored either way, and
/// [`remove_profile`] treats "already gone" as success.
pub fn tear_down(mut launched: Launched) -> Result<(), LaunchError> {
    launched.kill_and_wait();
    remove_profile_with_retry(&launched.profile_dir).map_err(LaunchError::ProfileCleanup)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_launch_carries_the_flags_that_silence_the_browsers_own_traffic() {
        let flags = launch_flags(Path::new("/tmp/p"), 8123);
        for required in [
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-component-update",
            "--disable-sync",
            "--headless=new",
        ] {
            assert!(
                flags.iter().any(|f| f == required),
                "missing {required}: {flags:?}"
            );
        }
    }

    #[test]
    fn routes_everything_through_the_proxy_including_localhost() {
        // Without the bypass override Chrome exempts loopback and private
        // addresses from the proxy, which would put a whole class of target
        // outside the one component that enforces §7.1.
        let flags = launch_flags(Path::new("/tmp/p"), 8123);
        assert!(flags.iter().any(|f| f == "--proxy-server=http://127.0.0.1:8123"));
        assert!(flags
            .iter()
            .any(|f| f.starts_with("--proxy-bypass-list=") && f.contains("<-loopback>")));
    }

    #[test]
    fn uses_an_ephemeral_profile_and_never_the_users_own() {
        let flags = launch_flags(Path::new("/tmp/p"), 8123);
        assert!(flags.iter().any(|f| f == "--user-data-dir=/tmp/p"));
    }

    // --- Regression tests directed by the security audit ---
    //
    // The audit verified every flag against the installed browser's own
    // switch table and found three that were silently no-ops. These pin
    // the corrected spelling and the absence of the fictitious ones, so a
    // future edit cannot reintroduce a flag that reads as protection while
    // doing nothing.

    #[test]
    fn uses_the_real_webrtc_switch_not_the_fictitious_forced_one() {
        let flags = launch_flags(Path::new("/tmp/p"), 8123);
        assert!(flags
            .iter()
            .any(|f| f == "--webrtc-ip-handling-policy=disable_non_proxied_udp"));
        assert!(
            !flags.iter().any(|f| f.starts_with("--force-webrtc-ip-handling-policy")),
            "the force- prefixed switch does not exist in the pinned browser: {flags:?}"
        );
    }

    #[test]
    fn does_not_carry_flags_verified_absent_from_the_pinned_browser() {
        let flags = launch_flags(Path::new("/tmp/p"), 8123);
        for absent in [
            "--disable-client-side-phishing-detection",
            "--safebrowsing-disable-auto-update",
            "--dns-prefetch-disable",
        ] {
            assert!(
                !flags.iter().any(|f| f == absent),
                "should not carry a no-op verified absent from the browser's switch table: {absent}"
            );
        }
    }

    #[test]
    fn disable_features_list_carries_only_names_verified_present() {
        let flags = launch_flags(Path::new("/tmp/p"), 8123);
        let disable_features = flags
            .iter()
            .find(|f| f.starts_with("--disable-features="))
            .expect("must carry exactly one --disable-features flag");
        let names: Vec<&str> = disable_features
            .trim_start_matches("--disable-features=")
            .split(',')
            .collect();
        for present in [
            "Translate",
            "MediaRouter",
            "DialMediaRouteProvider",
            "OptimizationHints",
            "AutofillServerCommunication",
            "DnsOverHttpsUpgrade",
            "NetworkTimeServiceQuerying",
            "PreconnectToSearch",
            "PreconnectToSearchDesktop",
        ] {
            assert!(names.contains(&present), "missing {present}: {names:?}");
        }
        for fictitious in [
            "OptimizationGuideModelDownloading",
            "OptimizationHintsFetching",
            "CertificateTransparencyComponentUpdater",
            "DnsOverHttps",
        ] {
            assert!(
                !names.contains(&fictitious),
                "carries a fictitious feature name: {fictitious}: {names:?}"
            );
        }
    }

    #[test]
    fn denies_a_remote_file_authority_including_the_scan_target() {
        // Both are SMB fetches, not fetches of the page the user asked for.
        for url in [
            "file://attacker.example/share/x.png",
            "file://rossi-editore.it/share/x.png",
        ] {
            assert!(!url_is_permitted(url), "should have been denied: {url}");
        }
    }

    #[test]
    fn denies_case_and_slash_variants_of_a_remote_file_authority() {
        // Directed by the security audit (M1): a scheme is case-insensitive
        // (the proxy audit already accepted `HTTP://` for the same reason),
        // and Windows reads extra leading slashes or a backslash as forming
        // a UNC authority even where the URL text looks like a plain path.
        for url in [
            "File://attacker.example/share/x.png",
            "file:////attacker.example/share/x.png",
            "file:///\\attacker.example\\share",
        ] {
            assert!(!url_is_permitted(url), "should have been denied: {url}");
        }
    }

    #[test]
    fn still_permits_the_six_paired_controls() {
        // Without these the requirement above is met by blocking everything and
        // breaking the app, which is not the requirement.
        for url in [
            "file:///app/index.html",
            "file://localhost/app/index.html",
            "devtools://devtools/bundled/x.js",
            "data:text/css,body{}",
            "blob:https://evil.example/uuid",
            "chrome-extension://abc/x.js",
        ] {
            assert!(url_is_permitted(url), "should have been permitted: {url}");
        }
    }

    #[test]
    fn tear_down_removes_the_profile_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let profile = dir.path().join("profile");
        std::fs::create_dir_all(profile.join("Default")).expect("mkdir");
        remove_profile(&profile).expect("remove");
        assert!(!profile.exists());
    }

    #[test]
    fn tear_down_of_a_missing_profile_is_not_an_error() {
        // Teardown runs on the failure path too, where the directory may never
        // have been created. It must not turn one failure into two.
        assert!(remove_profile(Path::new("/tmp/traccia-does-not-exist-xyz")).is_ok());
    }

    // --- Tests added beyond the brief ---
    //
    // The brief's explicit test list covers the flag contents and the pure
    // url_is_permitted spec. It does not cover: the symlink-plant guard on
    // profile creation, the DevToolsActivePort read, or what happens when
    // the child process exits before ever opening its debugging port — all
    // three are named as required reporting in the task instructions, and
    // "report on it" is hollow without a test backing the claim.

    #[test]
    fn profile_dir_creation_refuses_a_path_that_already_exists() {
        // A plain pre-existing directory or file at the target path must not
        // be silently reused or replaced.
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("profile");
        std::fs::create_dir(&target).expect("pre-create");
        let err = create_profile_dir(&target).expect_err("must refuse an existing directory");
        assert!(matches!(err, LaunchError::ProfileDirExists(_, _)));
    }

    #[cfg(unix)]
    #[test]
    fn profile_dir_creation_refuses_a_planted_symlink_without_following_it() {
        // The property under test: an unprivileged local process that
        // pre-creates the target path as a symlink to somewhere else must
        // not have that symlink followed and written into.
        let dir = tempfile::tempdir().expect("tempdir");
        let elsewhere = dir.path().join("elsewhere");
        std::fs::create_dir(&elsewhere).expect("pre-create elsewhere");
        let target = dir.path().join("profile");
        std::os::unix::fs::symlink(&elsewhere, &target).expect("symlink");

        let err = create_profile_dir(&target).expect_err("must refuse a planted symlink");
        assert!(matches!(err, LaunchError::ProfileDirExists(_, _)));
        // Nothing was written through the symlink into `elsewhere`.
        assert_eq!(std::fs::read_dir(&elsewhere).expect("read_dir").count(), 0);
    }

    #[test]
    fn parse_devtools_port_reads_the_first_line() {
        assert_eq!(
            parse_devtools_port("54321\n/devtools/browser/abc-def").expect("parse"),
            54321
        );
    }

    #[test]
    fn parse_devtools_port_rejects_nonsense() {
        for bad in ["", "not-a-port", "\n54321"] {
            assert!(parse_devtools_port(bad).is_err(), "should reject: {bad:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn wait_for_devtools_port_stops_as_soon_as_the_process_exits_instead_of_hanging_to_the_timeout(
    ) {
        // If the browser exits immediately, the caller must find out fast,
        // not sit out the whole readiness timeout waiting for a file that a
        // dead process can never write.
        let dir = tempfile::tempdir().expect("tempdir");
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("exit 0")
            .spawn()
            .expect("spawn");

        let start = Instant::now();
        let result = wait_for_devtools_port(&mut child, dir.path(), Duration::from_secs(10));
        let elapsed = start.elapsed();

        assert!(matches!(
            result,
            Err(LaunchError::ProcessExitedBeforeReady { code: Some(0) })
        ));
        assert!(
            elapsed < Duration::from_secs(5),
            "took {elapsed:?} — did not bail out early on process exit"
        );
    }

    #[cfg(unix)]
    #[test]
    fn wait_for_devtools_port_times_out_if_the_port_never_appears() {
        // The browser never opening its debugging port must produce a bounded
        // failure, not an unbounded hang.
        let dir = tempfile::tempdir().expect("tempdir");
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 5")
            .spawn()
            .expect("spawn");

        let result = wait_for_devtools_port(&mut child, dir.path(), Duration::from_millis(150));
        assert!(matches!(result, Err(LaunchError::DevToolsPortTimeout)));

        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(unix)]
    #[test]
    fn wait_for_devtools_port_succeeds_once_the_file_appears() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("DevToolsActivePort"), "9222\n/x").expect("write");
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 5")
            .spawn()
            .expect("spawn");

        let result = wait_for_devtools_port(&mut child, dir.path(), Duration::from_secs(10));
        assert_eq!(result.expect("should read the port"), 9222);

        let _ = child.kill();
        let _ = child.wait();
    }

    // --- Drop / tear_down (directed by the security audit, I4) ---

    #[cfg(unix)]
    #[test]
    fn dropping_launched_kills_the_process_and_removes_the_profile() {
        // The property under test: a panic, an early return, or any path
        // that drops a `Launched` without going through `tear_down` must
        // still not leak a running browser or a profile full of cookies.
        let dir = tempfile::tempdir().expect("tempdir");
        let profile = dir.path().join("profile");
        std::fs::create_dir_all(&profile).expect("mkdir");
        let child = Command::new("sh")
            .arg("-c")
            .arg("sleep 5")
            .spawn()
            .expect("spawn");
        let pid = child.id();

        {
            let _launched = Launched {
                child,
                profile_dir: profile.clone(),
                devtools_port: 0,
            };
            // Dropped here, at the end of this block.
        }

        assert!(
            !profile.exists(),
            "profile directory should have been removed by Drop"
        );
        // `kill -0` succeeds only while the pid still exists; a fresh pid
        // reuse race is not a concern on the timescale of this test.
        let status = Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .status()
            .expect("kill -0");
        assert!(
            !status.success(),
            "process should have been killed by Drop"
        );
    }

    #[cfg(unix)]
    #[test]
    fn tear_down_kills_the_process_and_removes_the_profile() {
        let dir = tempfile::tempdir().expect("tempdir");
        let profile = dir.path().join("profile");
        std::fs::create_dir_all(&profile).expect("mkdir");
        let child = Command::new("sh")
            .arg("-c")
            .arg("sleep 5")
            .spawn()
            .expect("spawn");

        let launched = Launched {
            child,
            profile_dir: profile.clone(),
            devtools_port: 0,
        };
        tear_down(launched).expect("tear_down");

        assert!(!profile.exists());
    }

    #[test]
    fn searches_chrome_before_edge() {
        let paths = candidate_paths();
        let first_chrome = paths.iter().position(|(b, _)| matches!(b, Browser::Chrome));
        let first_edge = paths.iter().position(|(b, _)| matches!(b, Browser::Edge));
        assert!(first_chrome.is_some(), "no Chrome candidate on this platform");
        assert!(first_edge.is_some(), "no Edge candidate on this platform");
        assert!(first_chrome < first_edge);
    }

    #[test]
    fn offers_at_least_one_absolute_candidate_per_browser() {
        for (_, p) in candidate_paths() {
            assert!(p.is_absolute(), "candidate is not absolute: {}", p.display());
        }
    }

    #[test]
    fn names_every_path_it_searched_when_nothing_is_found() {
        // The failure a user actually hits is "I have a browser and it says I
        // don't". A bare "no browser found" is unactionable; the list is what
        // lets them see it looked in the wrong place.
        let err = discover_in(&[]);
        match err {
            Err(DiscoveryError::NoneFound { searched }) => {
                assert_eq!(searched.len(), candidate_paths().len());
                assert!(!searched.is_empty());
            }
            Ok(_) => panic!("found a browser among no candidates"),
        }
    }

    #[test]
    fn returns_the_first_candidate_that_exists() {
        let dir = tempfile::tempdir().expect("tempdir");
        let second = dir.path().join("second");
        std::fs::write(&second, b"x").expect("write");
        let missing = dir.path().join("first");
        let found = discover_in(&[
            (Browser::Chrome, missing),
            (Browser::Edge, second.clone()),
        ])
        .expect("should find the second");
        assert_eq!(found.path, second);
        assert!(matches!(found.browser, Browser::Edge));
    }

    #[test]
    fn never_panics_on_a_candidate_list_full_of_nonsense() {
        for bad in ["", " ", "\0not-a-path", "relative/path"] {
            let _ = discover_in(&[(Browser::Chrome, PathBuf::from(bad))]);
        }
    }
}
