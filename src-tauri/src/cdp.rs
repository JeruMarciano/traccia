//! Observing which hosts a scanned site contacts, over the Chrome DevTools
//! Protocol.
//!
//! **This module observes. It does not enforce.** By the time a request
//! reaches CDP the proxy has already made the admission decision — anything
//! outside the scan origins was refused before this module ever saw it
//! (`proxy.rs`, and `docs/decisions/2026-08-01-plain-http-audit.md`). What CDP
//! adds is *attribution*: which host, how many requests. Nothing here is a
//! guard, and nothing here should ever be read as one. The CDP spike measured
//! this view missing 15 of 37 hosts the proxy saw, which is why the proxy's
//! ledger and not this module is the source of truth for what was contacted.

use std::collections::{BTreeMap, VecDeque};
use std::future::poll_fn;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chromiumoxide::cdp::browser_protocol::network::EventRequestWillBeSent;
use chromiumoxide::cdp::browser_protocol::page::{EventLoadEventFired, NavigateParams};
use chromiumoxide::cdp::browser_protocol::target::{
    CreateTargetParams, CreateTargetReturns, EventAttachedToTarget, SessionId, SetAutoAttachParams,
};
use chromiumoxide::cdp::js_protocol::runtime::EvaluateParams;
use chromiumoxide::conn::Connection;
use chromiumoxide::types::{CallId, CdpJsonEventMessage, Message, MethodId};
use futures_core::Stream;

use crate::browser::Launched;

/// One host the scanned pages contacted, and how many requests went to it.
///
/// Serialises to `ScanResult["hosts"][n]` in `src/core/types.ts`: `host`,
/// `requestCount`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedHost {
    pub host: String,
    pub request_count: u32,
}

/// What one scan saw.
///
/// Serialises to
/// `{ "hosts": [...], "pagesVisited": n, "possibleGaps": n, "stoppedEarly": bool }`.
/// `ScanResult`'s remaining field, `scannedHost`, is the caller's — Task 8
/// knows the URL the user typed and this module deliberately does not decide
/// what "the scanned host" is.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub hosts: Vec<ObservedHost>,
    pub pages_visited: u32,
    /// **How many places this map may be incomplete.** Read it as that
    /// sentence and no other.
    ///
    /// It is deliberately *not* "how many targets ran unobserved", which is
    /// what it was first called and which the number cannot honestly claim.
    /// The places it counts are not all the same size:
    ///
    /// - A frame whose `Network.enable` was refused ran unobserved: one
    ///   place, and the hosts it contacted are missing.
    /// - A frame whose `Target.setAutoAttach` was refused was *itself*
    ///   observed, but an **unknown** number of frames inside it were never
    ///   reached. One place, standing for anything from zero to many.
    /// - An attach event this module could not parse: one place, of unknown
    ///   size, standing for a target it could not even name.
    /// - The host or page limits being reached: one place, standing for
    ///   everything past the cap.
    ///
    /// A count of what is behind the second and third of those is unknowable
    /// by construction, so nothing here implies a precision that does not
    /// exist. One number, because the action any of them implies is
    /// identical: this map is known to be incomplete, and the copy that says
    /// so must stay neutral — "not yet identified", never "violation".
    ///
    /// Zero means no gap was *detected*. It is not a proof of completeness:
    /// §8 of the task report lists what this module cannot see at all,
    /// starting with `wss://`.
    ///
    /// Task 9 surfaces it; Task 10's printed limits statement must mention it
    /// when it is non-zero. It is not a scan failure — a partial map is still
    /// useful, and the honest thing is to hand it over with its gaps counted.
    pub possible_gaps: u32,
    /// True when the scan was cancelled rather than run to completion.
    ///
    /// Without this, nothing in the payload distinguishes "this finished scan
    /// has holes in it" from "you stopped it, of course it has holes". Both
    /// produce a non-zero [`Self::possible_gaps`], and presenting them the same
    /// way spends the warning's credibility on the case where the user already
    /// knows — which teaches them to ignore it before Task 10 ever prints the
    /// number for the case where they do not.
    ///
    /// **Task 9 must present a cancelled scan as *stopped* first, with its gap
    /// count as detail — never with the same signal a completed-but-holey scan
    /// gets.**
    pub stopped_early: bool,
}

/// The most distinct gap keys tracked before the ledger stops deduplicating.
/// Bounded because the keys come from the browser, and the browser is driving
/// a page this app does not trust.
const MAX_GAP_KEYS: usize = 512;

/// Counts *distinct places* the map may be incomplete.
///
/// A set, not a counter, for one reason: Chrome re-issues
/// `Target.attachedToTarget` for the same target when it navigates
/// cross-process, so the same frame failing to arm twice is one gap in the
/// map, not two. Past [`MAX_GAP_KEYS`] it stops deduplicating and simply
/// counts — overstating a gap is the safe direction, understating one is the
/// failure this whole mechanism exists to prevent.
#[derive(Debug, Default)]
struct GapLedger {
    keys: std::collections::BTreeSet<String>,
    beyond_capacity: u32,
}

impl GapLedger {
    /// Notes one place the map may be incomplete. `key` identifies the place
    /// — a target id, a session id, or a fixed string for a limit — so the
    /// same place noted twice counts once.
    fn note(&mut self, key: impl Into<String>) {
        if self.keys.len() >= MAX_GAP_KEYS {
            self.beyond_capacity = self.beyond_capacity.saturating_add(1);
            return;
        }
        self.keys.insert(key.into());
    }

    fn count(&self) -> u32 {
        u32::try_from(self.keys.len())
            .unwrap_or(u32::MAX)
            .saturating_add(self.beyond_capacity)
    }
}

/// The longest a host may be before it is refused: RFC 1035's limit on a
/// fully-qualified domain name. Every real host is under it.
///
/// This is a bound on **attacker-chosen data**, not a tidiness rule.
/// `Network.requestWillBeSent` fires *before* the proxy refuses anything, so a
/// page looping `fetch("https://" + "a".repeat(1e6) + Math.random() + ".x/")`
/// would otherwise write megabytes of its own choosing into the map, which is
/// then serialised toward the renderer and saved into the project file.
const MAX_HOST_LEN: usize = 253;

/// The most distinct hosts one scan will record. Far above any real site —
/// the CDP spike's worst page reached 37 — and finite, for the same reason as
/// [`MAX_HOST_LEN`]. Reaching it is a gap in the map, not a silent truncation:
/// see [`HostAccumulator::overflowed`].
const MAX_HOSTS: usize = 4096;

/// Counts requests per host.
///
/// Pure: it is handed URL strings and returns a sorted list. Sorted by host
/// name rather than by arrival order because arrival order is network timing,
/// and a map that reorders itself between two runs of the same scan is not
/// something a user can trust.
#[derive(Debug, Default)]
pub struct HostAccumulator {
    counts: BTreeMap<String, u32>,
    overflowed: bool,
}

impl HostAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records one request. A URL with no host of interest — `data:`,
    /// `about:`, `blob:`, a relative path, anything unparseable — is dropped
    /// rather than counted under some invented name.
    pub fn record(&mut self, url: &str) {
        let Some(host) = http_host(url) else {
            return;
        };
        if !self.counts.contains_key(&host) && self.counts.len() >= MAX_HOSTS {
            // Not silently dropped: the caller turns this into a counted gap,
            // because a host list that stopped growing is a host list that is
            // known to be incomplete.
            self.overflowed = true;
            return;
        }
        let count = self.counts.entry(host).or_insert(0);
        *count = count.saturating_add(1);
    }

    /// True once a request was refused for want of room. The map is then known
    /// to be incomplete and must say so.
    pub fn overflowed(&self) -> bool {
        self.overflowed
    }

    pub fn finish(self) -> Vec<ObservedHost> {
        self.counts
            .into_iter()
            .map(|(host, request_count)| ObservedHost {
                host,
                request_count,
            })
            .collect()
    }
}

/// The host of an absolute `http(s)` URL, lowercased, without userinfo, port
/// or trailing dot. `None` for anything else, and for a host longer than
/// [`MAX_HOST_LEN`].
///
/// Hand-rolled rather than pulled from a URL crate: the whole of what this
/// needs is "scheme, then authority, then stop", and the dependency budget in
/// `Cargo.toml` is the reason. The scheme check is what keeps
/// `blob:https://x/y` out — a naive search for `://` finds one there and would
/// invent a host called `x`.
fn http_host(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once(':')?;
    if !(scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https")) {
        return None;
    }
    let authority = rest.strip_prefix("//")?;
    let authority = authority.split(['/', '?', '#']).next()?;
    // Userinfo is everything before the last '@'; a '@' may legally appear
    // inside the userinfo itself, so the *last* one is the delimiter.
    let host_port = match authority.rsplit_once('@') {
        Some((_, after)) => after,
        None => authority,
    };
    let host = strip_trailing_dot(strip_port(host_port));
    if !host_is_wellformed(host) {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

/// The same shape `admission.rs::vet_host` accepts: ASCII, at most
/// [`MAX_HOST_LEN`], `[a-z0-9.-]` only, no empty labels — plus a bracketed
/// IPv6 literal, which that function's caller handles separately and this one
/// does not.
///
/// **Rejects rather than sanitises**, and that is the point. Without this,
/// up to 253 bytes of arbitrary text — control characters, newlines, Unicode
/// homographs of a real vendor's name — would travel out of here into
/// `ObservedHost.host`, and from there to the renderer and into the saved
/// project file. Length alone bounds the memory; it does not stop a host that
/// *reads* as `gooğle-analytics.com` from sitting in the map. Matching the
/// admission guard's allowlist here is cheaper than remembering to sanitise at
/// every point downstream, and a host outside it was never a name the proxy
/// would have allowed a connection to in the first place.
fn host_is_wellformed(host: &str) -> bool {
    if host.is_empty() || host.len() > MAX_HOST_LEN || !host.is_ascii() {
        return false;
    }
    if let Some(inner) = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
        return inner.parse::<std::net::Ipv6Addr>().is_ok();
    }
    if !host
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
    {
        return false;
    }
    // `..` or a leading dot is not a name.
    !host.split('.').any(|label| label.is_empty())
}

/// Drops one trailing dot, and only one.
///
/// `example.com.` and `example.com` are the same host — the dot is the
/// explicit root label. This must match `admission.rs`'s normalisation
/// exactly, which strips one: the proxy's ledger is the source of truth for
/// what was contacted, and a host recorded here under a name the ledger does
/// not use would split its request count in two and miss the vendor
/// dictionary's lookup in Task 9.
fn strip_trailing_dot(host: &str) -> &str {
    host.strip_suffix('.').unwrap_or(host)
}

/// Drops a `:port` suffix. An IPv6 literal is bracketed (`[::1]:443`) and its
/// colons are part of the address, so the bracket ends the host.
fn strip_port(host_port: &str) -> &str {
    if let Some(close) = host_port.find(']') {
        if host_port.starts_with('[') {
            return &host_port[..=close];
        }
    }
    match host_port.split_once(':') {
        Some((host, _)) => host,
        None => host_port,
    }
}

/// The links on `entry_url`'s page that are worth loading next: same scheme
/// and same host as the entry URL, absolute, not the entry page itself, in the
/// order the page listed them, deduplicated, truncated to `limit`.
///
/// Scheme and host are compared exactly. `www.rossi-editore.it` is a different
/// host from `rossi-editore.it` and is not followed — they are frequently
/// different servers, and guessing that they are the same site would take the
/// scan somewhere the user did not ask for.
pub fn same_origin_links(entry_url: &str, links: &[&str], limit: usize) -> Vec<String> {
    let Some(entry_origin) = origin(entry_url) else {
        return Vec::new();
    };
    let entry_key = canonical(entry_url);
    let mut out: Vec<String> = Vec::new();
    for link in links {
        let link = link.split('#').next().unwrap_or("");
        if link.is_empty() || origin(link).as_ref() != Some(&entry_origin) {
            continue;
        }
        let key = canonical(link);
        if key == entry_key || out.iter().any(|seen| canonical(seen) == key) {
            continue;
        }
        // Tested *before* the push, not after: testing after returns one link
        // for a limit of zero, which contradicts this function's own contract
        // and would be a trap for a caller passing a computed budget.
        if out.len() >= limit {
            break;
        }
        out.push(link.to_string());
    }
    out
}

/// `(scheme, host-and-port)` of an absolute `http(s)` URL, lowercased, with
/// the scheme's default port and a trailing dot normalised away.
///
/// The normalisation matters because the alternative is a scan that visits one
/// page twice or refuses to visit a page it should: `https://x.example:443/b`
/// and `https://x.example/b` are one origin, and `x.example.` is one host with
/// `x.example`.
fn origin(url: &str) -> Option<(String, String)> {
    let (scheme, rest) = url.split_once(':')?;
    if !(scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https")) {
        return None;
    }
    let scheme = scheme.to_ascii_lowercase();
    let authority = rest.strip_prefix("//")?;
    let authority = authority.split(['/', '?', '#']).next()?;
    let host_port = match authority.rsplit_once('@') {
        Some((_, after)) => after,
        None => authority,
    };
    let host = strip_trailing_dot(strip_port(host_port));
    if host.is_empty() || host.len() > MAX_HOST_LEN {
        return None;
    }
    let default_port = if scheme == "https" { "443" } else { "80" };
    let port = match host_port.rsplit_once(':') {
        // A colon inside a bracketed IPv6 literal is part of the address, not
        // a port separator.
        Some((_, port)) if !port.contains(']') && !port.is_empty() => port,
        _ => default_port,
    };
    let host = host.to_ascii_lowercase();
    let authority = if port == default_port {
        host
    } else {
        format!("{host}:{port}")
    };
    Some((scheme, authority))
}

/// A URL reduced to what decides "is this the same page": the fragment is
/// gone, and a bare origin is treated as its own root — `https://x` and
/// `https://x/` are one page, and following both would spend two of the
/// `max_pages` budget on one document.
fn canonical(url: &str) -> String {
    let without_fragment = url.split('#').next().unwrap_or("");
    match without_fragment.strip_suffix('/') {
        Some(trimmed) => trimmed.to_string(),
        None => without_fragment.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/// A shared "stop asking for more pages" flag.
///
/// Deliberately not `tokio_util::sync::CancellationToken`: `tokio-util` is not
/// in this crate's build graph on macOS (`cargo tree -e normal -i tokio-util`
/// prints nothing), and the whole of what is needed here is a bool that two
/// tasks can see. See the dependency budget in `Cargo.toml`.
#[derive(Debug, Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum CdpError {
    /// The profile directory is not there at all. Distinct from
    /// [`CdpError::DevToolsPortMissing`]: this is a browser that has gone
    /// away, not a browser that never opened its debugging port.
    ProfileGone(std::path::PathBuf),
    /// `DevToolsActivePort` never appeared inside the bounded wait. The
    /// browser is running; it never opened the port.
    DevToolsPortMissing,
    DevToolsPortUnreadable(std::io::Error),
    /// The file is there but is not the two lines it is supposed to be, or
    /// names a port other than the one this process's own launch observed.
    DevToolsPortMalformed(String),
    Connect(String),
    Transport(String),
    /// The WebSocket closed under us. A scan is *not* returned in this case:
    /// a browser that died mid-scan has seen fewer hosts than a browser that
    /// finished, and reporting the short list as a completed scan is the one
    /// failure direction this release exists to avoid.
    BrowserGone,
    Timeout(MethodId),
    /// The browser answered a command with an error.
    Protocol { method: MethodId, message: String },
    Serialisation(String),
}

impl std::fmt::Display for CdpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ProfileGone(p) => write!(f, "browser profile directory is gone: {}", p.display()),
            Self::DevToolsPortMissing => {
                write!(f, "the browser never opened its debugging port")
            }
            Self::DevToolsPortUnreadable(e) => write!(f, "DevToolsActivePort unreadable: {e}"),
            Self::DevToolsPortMalformed(s) => write!(f, "DevToolsActivePort malformed: {s:?}"),
            Self::Connect(e) => write!(f, "could not connect to the browser: {e}"),
            Self::Transport(e) => write!(f, "devtools transport error: {e}"),
            Self::BrowserGone => write!(f, "the browser closed the connection during the scan"),
            Self::Timeout(m) => write!(f, "the browser did not answer {m} in time"),
            Self::Protocol { method, message } => write!(f, "{method} failed: {message}"),
            Self::Serialisation(e) => write!(f, "could not build a devtools command: {e}"),
        }
    }
}

impl std::error::Error for CdpError {}

// ---------------------------------------------------------------------------
// Timings
// ---------------------------------------------------------------------------

/// Bound on waiting for `DevToolsActivePort`, matching the CDP spike's F7.
/// Fixed before the loop starts, so a process writing the file one byte at a
/// time cannot push the deadline out.
const DEVTOOLS_FILE_TIMEOUT: Duration = Duration::from_secs(15);
const DEVTOOLS_FILE_POLL: Duration = Duration::from_millis(50);
/// Bound on any single command's response. A browser that stops answering
/// must fail the scan, not hang the app.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
/// Bound on waiting for the page target to attach after `Target.createTarget`.
const ATTACH_TIMEOUT: Duration = Duration::from_secs(15);
/// Bound on waiting for `Page.loadEventFired` after a navigation.
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
/// How long to keep reading events after load, for the trackers that fire
/// late. Under-reporting is the dangerous direction, so this is not zero.
const SETTLE_AFTER_LOAD: Duration = Duration::from_secs(3);
/// How long a single read may block before cancellation is re-checked.
const CANCEL_POLL: Duration = Duration::from_millis(100);
/// Cap on the number of `href`s taken out of a page before filtering, so a
/// hostile page cannot return a hundred megabytes of strings.
const MAX_LINKS_READ: usize = 500;
/// Cap on the length of a single `href`, applied inside the page. Well past
/// any real URL and past IE's old 2,083-character limit; the point is that
/// `MAX_LINKS_READ` bounds the count and this bounds the bytes.
const MAX_LINK_LEN: usize = 4096;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

/// The two things this module needs from a DevTools WebSocket: queue a command
/// addressed to an arbitrary session, and read the next message.
///
/// A trait rather than a bare `Connection` for one reason: the ordering
/// property this task exists to guarantee — arm the child session, *then*
/// resume it — is only worth as much as the test that observes the actual
/// bytes going out. A fake implementation in `mod tests` records every submit
/// in order and refuses a second submit while one is unanswered, which is what
/// turns "the code awaits each response" from a claim into a measurement.
trait CdpTransport {
    fn submit(
        &mut self,
        method: MethodId,
        session: Option<SessionId>,
        params: serde_json::Value,
    ) -> Result<CallId, CdpError>;

    async fn recv(&mut self) -> Option<Result<Message<CdpJsonEventMessage>, CdpError>>;
}

impl CdpTransport for Connection<CdpJsonEventMessage> {
    fn submit(
        &mut self,
        method: MethodId,
        session: Option<SessionId>,
        params: serde_json::Value,
    ) -> Result<CallId, CdpError> {
        Connection::submit_command(self, method, session, params)
            .map_err(|e| CdpError::Serialisation(e.to_string()))
    }

    async fn recv(&mut self) -> Option<Result<Message<CdpJsonEventMessage>, CdpError>> {
        // `Connection` only puts queued commands on the wire while it is being
        // polled as a `Stream`, so this is both the read and the flush.
        poll_fn(|cx| Pin::new(&mut *self).poll_next(cx))
            .await
            .map(|r| r.map_err(|e| CdpError::Transport(e.to_string())))
    }
}

// ---------------------------------------------------------------------------
// The attach sequence — the part the CDP spike proved must be exactly this
// ---------------------------------------------------------------------------

/// `Target.setAutoAttach` as F1 requires it: auto-attach on, new targets
/// paused on start, flat sessions.
///
/// `flatten: true` is what makes a cross-origin iframe's own session
/// addressable, and without it that iframe's trackers never appear. Every one
/// of the three is load-bearing; none is a default.
fn auto_attach_params() -> Result<serde_json::Value, CdpError> {
    let mut params = SetAutoAttachParams::new(true, true);
    params.flatten = Some(true);
    to_params(&params)
}

/// What a failed arming step means. **Do not collapse these two into one
/// tolerant path.** They exist because "tolerate every error" hides a real
/// gap, and "fail the scan on any error" breaks on target types that
/// legitimately do not implement a domain. Each step below says which it is
/// and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OnFailure {
    /// A failure that carries no information: the target simply does not
    /// implement this domain. Not counted, not reported.
    Expected,
    /// A failure that means this target ran without this module being able to
    /// see what it contacted, or without its own children being reachable.
    /// Counted into [`Observation::unobserved_targets`], so the gap is
    /// visible rather than silent.
    LosesObservation,
}

/// What must reach a newly attached session, in this order, before it is
/// allowed to run.
///
/// Returned as data rather than issued inline so the order is a value a test
/// can assert on. The order is the whole point:
///
/// 1. `Network.enable` — **[`OnFailure::LosesObservation`]**. Observation is
///    armed first, or the requests the target makes in its first milliseconds
///    are never seen. There is no target type this is expected to fail on, so
///    a failure here means exactly one thing: this target is now running
///    unobserved. Counted.
/// 2. `Page.enable` — **[`OnFailure::Expected`]**. Load events, for settling.
///    A worker has no `Page` domain and will refuse this; that is not a gap in
///    the map, only a target that is not a page. Not counted.
/// 3. `Target.setAutoAttach` — **[`OnFailure::LosesObservation`]**. Re-issued
///    on this session, which is what carries the recursion down into nested
///    frames. `chromiumoxide`'s own recursion is the browser's, driven by
///    `setDiscoverTargets`, and is not re-driven per attach (preflight §1);
///    this module drives no `setDiscoverTargets` and relies on nothing but
///    this line. A failure here does not blind this target, but it blinds
///    every frame *inside* it — the same kind of silent absence, so it is
///    counted the same way.
/// 4. `Runtime.runIfWaitingForDebugger` — **[`OnFailure::Expected`]**, and
///    only now does the target run. Sent last, and only when the target
///    actually said it was waiting. A failure to resume is not an observation
///    gap; it is a target that never runs, and there is nothing to miss.
///
/// Every step is attempted regardless of what the previous one answered. A
/// target left waiting on the debugger because an earlier command errored is
/// worse than a target known not to have been observed: it hangs the scan.
fn arming_sequence(
    waiting_for_debugger: bool,
) -> Result<Vec<(MethodId, serde_json::Value, OnFailure)>, CdpError> {
    use chromiumoxide::cdp::browser_protocol::{network, page};
    use chromiumoxide::cdp::js_protocol::runtime;

    let mut steps = vec![
        (
            MethodId::from(network::EnableParams::IDENTIFIER),
            to_params(&network::EnableParams::default())?,
            OnFailure::LosesObservation,
        ),
        (
            MethodId::from(page::EnableParams::IDENTIFIER),
            to_params(&page::EnableParams::default())?,
            OnFailure::Expected,
        ),
        (
            MethodId::from(SetAutoAttachParams::IDENTIFIER),
            auto_attach_params()?,
            OnFailure::LosesObservation,
        ),
    ];
    if waiting_for_debugger {
        steps.push((
            MethodId::from(runtime::RunIfWaitingForDebuggerParams::IDENTIFIER),
            to_params(&runtime::RunIfWaitingForDebuggerParams::default())?,
            OnFailure::Expected,
        ));
    }
    Ok(steps)
}

fn to_params<T: serde::Serialize>(value: &T) -> Result<serde_json::Value, CdpError> {
    serde_json::to_value(value).map_err(|e| CdpError::Serialisation(e.to_string()))
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/// A session this driver has attached to and armed.
#[derive(Debug, Clone)]
struct Attached {
    session_id: SessionId,
    target_id: String,
    kind: String,
}

/// A `Target.attachedToTarget` waiting to be dealt with.
enum Attachment {
    /// The event was understood. Arm it, recurse into it, resume it.
    Parsed(Box<EventAttachedToTarget>),
    /// The event did **not** deserialise — the browser sent a `targetInfo`
    /// shape this build of the generated protocol does not accept.
    ///
    /// This is not hypothetical. `TargetInfo` declares `title`, `url`,
    /// `attached` and `can_access_opener` as non-optional, and Task 6 launches
    /// whichever Chrome or Edge is on the user's machine, unpinned. One
    /// browser build that omits `canAccessOpener` would otherwise make every
    /// out-of-process iframe vanish from the map with nothing to show for it.
    ///
    /// The session id is read straight out of the raw JSON, which does not
    /// depend on the typed struct parsing, so the target can still be resumed
    /// — a target left paused stays paused for the life of the scan. It cannot
    /// be armed or recursed into, so it is a gap, and it is counted as one.
    Unparsed { session_id: SessionId },
}

/// The most sessions tracked for the `page_session` lookup. Bounded because
/// the browser appends one per attach event and the page driving those is not
/// trusted; the page target this is searched for attaches within the first few
/// events, long before any real site approaches this.
const MAX_TRACKED_SESSIONS: usize = 512;

/// How long one drain of the attach queue may take before it gives up and
/// counts the rest as gaps. A page can enqueue attachments faster than four
/// round-trips each can drain them — `new Worker(URL.createObjectURL(...))` in
/// a loop — so this is what keeps a scan bounded, and cancellation is checked
/// between targets for the same reason.
const ARM_DRAIN_BUDGET: Duration = Duration::from_secs(20);

struct Driver<T: CdpTransport> {
    transport: T,
    acc: HostAccumulator,
    /// Attachments that have arrived and not yet been dealt with. A queue
    /// rather than immediate handling because an attach can arrive while
    /// another command is in flight, and the target is paused meanwhile.
    pending_attach: VecDeque<Attachment>,
    attached: Vec<Attached>,
    load_fired: bool,
    /// Distinct places the map may be incomplete. See [`GapLedger`] and
    /// [`Observation::possible_gaps`].
    gaps: GapLedger,
}

impl<T: CdpTransport> Driver<T> {
    fn new(transport: T) -> Self {
        Self {
            transport,
            acc: HostAccumulator::new(),
            pending_attach: VecDeque::new(),
            attached: Vec::new(),
            load_fired: false,
            gaps: GapLedger::default(),
        }
    }

    /// Sends one command and reads until its own response arrives, servicing
    /// every event that turns up meanwhile.
    ///
    /// This is the "await each command's response before sending the next"
    /// that the ordering guarantee rests on: nothing else in this module puts
    /// a command on the wire, so a second command cannot leave before the
    /// first is answered.
    async fn call(
        &mut self,
        session: Option<SessionId>,
        method: MethodId,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, CdpError> {
        let id = self.transport.submit(method.clone(), session, params)?;
        let deadline = Instant::now() + COMMAND_TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(CdpError::Timeout(method));
            }
            match self.read(remaining).await? {
                Some(Message::Response(response)) if response.id == id => {
                    return match response.error {
                        Some(e) => Err(CdpError::Protocol {
                            method,
                            message: e.message,
                        }),
                        None => Ok(response.result.unwrap_or(serde_json::Value::Null)),
                    };
                }
                // A response to nothing this driver is waiting on. Only one
                // command is ever in flight, so this is the browser talking
                // about something else; ignored rather than trusted.
                Some(Message::Response(_)) => {}
                Some(Message::Event(event)) => self.on_event(event),
                None => return Err(CdpError::Timeout(method)),
            }
        }
    }

    /// One message, or `None` if `budget` ran out first.
    async fn read(
        &mut self,
        budget: Duration,
    ) -> Result<Option<Message<CdpJsonEventMessage>>, CdpError> {
        match tokio::time::timeout(budget, self.transport.recv()).await {
            Err(_elapsed) => Ok(None),
            Ok(None) => Err(CdpError::BrowserGone),
            Ok(Some(Err(e))) => Err(e),
            Ok(Some(Ok(message))) => Ok(Some(message)),
        }
    }

    fn on_event(&mut self, event: CdpJsonEventMessage) {
        let method = event.method.as_ref();
        if method == EventRequestWillBeSent::IDENTIFIER {
            // Read straight out of the JSON rather than deserialising the
            // whole typed event: this is the hot path, and a single unknown
            // enum variant anywhere else in the payload must not cost a host.
            if let Some(url) = event
                .params
                .get("request")
                .and_then(|r| r.get("url"))
                .and_then(|u| u.as_str())
            {
                self.acc.record(url);
            }
        } else if method == EventAttachedToTarget::IDENTIFIER {
            // A target this module cannot parse must not simply disappear.
            // It would be armed by nothing, resumed by nothing, and counted by
            // nothing — a hole in the map that the scan then reports as clean,
            // which is strictly worse than a target that failed to arm,
            // because that at least leaves a counted gap.
            match serde_json::from_value::<EventAttachedToTarget>(event.params.clone()) {
                Ok(attached) => self
                    .pending_attach
                    .push_back(Attachment::Parsed(Box::new(attached))),
                Err(_) => {
                    // The session id lives at the top of the params and does
                    // not depend on `targetInfo` parsing, so the target can
                    // still be resumed even though it cannot be armed.
                    match event.params.get("sessionId").and_then(|s| s.as_str()) {
                        Some(session_id) => {
                            self.gaps.note(format!("session:{session_id}"));
                            self.pending_attach.push_back(Attachment::Unparsed {
                                session_id: SessionId::from(session_id.to_string()),
                            });
                        }
                        // Not even the session id was readable. Nothing can be
                        // sent to this target and it will stay paused; all
                        // that is left is to say the map has a hole in it.
                        None => self.gaps.note("attach:unidentifiable"),
                    }
                }
            }
        } else if method == EventLoadEventFired::IDENTIFIER {
            self.load_fired = true;
        }
    }

    /// Arms every session that has attached and not yet been armed, including
    /// any that attach *while* this is running — which is how a nested frame
    /// inside a nested frame is reached.
    ///
    /// **Bounded and cancellable between targets**, not only between drains. A
    /// page can enqueue attachments faster than four round-trips each can
    /// drain them, so without the deadline an attach storm would make the scan
    /// neither stoppable nor finite. Whatever is left when the budget or the
    /// cancel flag ends it is counted as gaps: a bounded partial scan that
    /// says it is partial beats an unbounded one.
    async fn arm_pending(
        &mut self,
        cancel: &CancellationToken,
        deadline: Instant,
    ) -> Result<(), CdpError> {
        while let Some(attachment) = self.pending_attach.pop_front() {
            if cancel.is_cancelled() || Instant::now() >= deadline {
                // **Deferred, not abandoned.** Put it back at the front so the
                // next drain retries it. Abandoning here would be worse than
                // losing attribution: the target was paused by this module's
                // own `waitForDebuggerOnStart` and, unresumed, never runs at
                // all — so it never issues its requests, and the proxy ledger,
                // which is the source of truth for what was contacted, never
                // sees its vendors either. Dropping the queue would not lose
                // the view of that frame, it would prevent the frame existing.
                //
                // Whatever is still queued when the scan ends is counted as a
                // gap by `observation`, which is the one place that decides
                // nothing more will be retried.
                self.pending_attach.push_front(attachment);
                return Ok(());
            }
            match attachment {
                Attachment::Unparsed { session_id } => {
                    // Already counted as a gap when it was parsed. All that is
                    // owed to it now is the resume, so it does not sit paused
                    // for the rest of the scan.
                    self.resume(&session_id).await?;
                }
                Attachment::Parsed(event) => self.arm(&event).await?,
            }
        }
        Ok(())
    }

    /// Sends only `Runtime.runIfWaitingForDebugger`, for a target that could
    /// not be armed. A refusal is expected and ignored — a target that was not
    /// waiting answers with an error, and that is not news.
    async fn resume(&mut self, session_id: &SessionId) -> Result<(), CdpError> {
        use chromiumoxide::cdp::js_protocol::runtime::RunIfWaitingForDebuggerParams;
        match self
            .call(
                Some(session_id.clone()),
                MethodId::from(RunIfWaitingForDebuggerParams::IDENTIFIER),
                to_params(&RunIfWaitingForDebuggerParams::default())?,
            )
            .await
        {
            Ok(_) | Err(CdpError::Protocol { .. }) => Ok(()),
            Err(e) => Err(e),
        }
    }

    async fn arm(&mut self, event: &EventAttachedToTarget) -> Result<(), CdpError> {
        let target_id = event.target_info.target_id.inner().clone();
        if self.attached.len() < MAX_TRACKED_SESSIONS {
            self.attached.push(Attached {
                session_id: event.session_id.clone(),
                target_id: target_id.clone(),
                kind: event.target_info.r#type.clone(),
            });
        }
        let mut lost_observation = false;
        for (method, params, on_failure) in arming_sequence(event.waiting_for_debugger)? {
            match self
                .call(Some(event.session_id.clone()), method, params)
                .await
            {
                Ok(_) => {}
                // The browser refused the command. Whether that is a gap in
                // the map or merely a target type that does not implement a
                // domain is `arming_sequence`'s call, step by step — read it
                // there. Either way the sequence carries on, so the resume is
                // still sent.
                Err(CdpError::Protocol { .. }) => {
                    if on_failure == OnFailure::LosesObservation {
                        lost_observation = true;
                    }
                }
                // A transport failure is not a refused command; the browser
                // has stopped talking and the scan cannot go on.
                Err(e) => return Err(e),
            }
        }
        if lost_observation {
            // Keyed on the target, so the same frame re-attaching after a
            // cross-process navigation and failing again is one gap, not two.
            self.gaps.note(format!("target:{target_id}"));
        }
        Ok(())
    }

    /// Records everything still queued as a gap and drops it. Called once, by
    /// `observation`, when the scan is over and nothing more will be retried:
    /// those targets were never armed and, being still paused, never ran.
    fn abandon_pending(&mut self) {
        for attachment in self.pending_attach.drain(..) {
            match attachment {
                Attachment::Parsed(event) => self
                    .gaps
                    .note(format!("target:{}", event.target_info.target_id.inner())),
                // Already counted when it failed to parse.
                Attachment::Unparsed { .. } => {}
            }
        }
    }

    /// Reads and services messages for `duration`, or until cancelled.
    ///
    /// `arm_deadline` is the caller's **real** outer budget for arming, and is
    /// deliberately a separate parameter rather than derived from `duration`.
    /// An earlier version passed this function's own deadline, which callers
    /// set to [`CANCEL_POLL`] — 100 ms — while arming one target costs four
    /// round trips. Every drain during a page load then expired immediately.
    /// `CANCEL_POLL` bounds how long a *read* may block; it is not an arming
    /// budget, and coupling the two starved the arming path on any site with
    /// more than a couple of out-of-process iframes.
    async fn settle(
        &mut self,
        duration: Duration,
        cancel: &CancellationToken,
        arm_deadline: Instant,
    ) -> Result<(), CdpError> {
        let deadline = Instant::now() + duration;
        loop {
            if cancel.is_cancelled() {
                return Ok(());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(());
            }
            if let Some(Message::Event(event)) = self.read(remaining.min(CANCEL_POLL)).await? {
                self.on_event(event);
            }
            self.arm_pending(cancel, arm_deadline).await?;
        }
    }

    /// Waits for the page target created by `Target.createTarget` to attach,
    /// arming everything that attaches along the way.
    ///
    /// `Ok(None)` means cancelled — which is not a failure and must not become
    /// one, or a scan stopped this early would report an error instead of the
    /// partial observation the user is entitled to. A target that never
    /// attaches inside `ATTACH_TIMEOUT` *is* an error.
    async fn page_session(
        &mut self,
        target_id: &str,
        cancel: &CancellationToken,
    ) -> Result<Option<SessionId>, CdpError> {
        let deadline = Instant::now() + ATTACH_TIMEOUT;
        loop {
            self.arm_pending(cancel, deadline).await?;
            if let Some(found) = self
                .attached
                .iter()
                .find(|a| a.target_id == target_id && a.kind == "page")
            {
                return Ok(Some(found.session_id.clone()));
            }
            if cancel.is_cancelled() {
                return Ok(None);
            }
            if Instant::now() >= deadline {
                return Err(CdpError::Timeout(MethodId::from(
                    EventAttachedToTarget::IDENTIFIER,
                )));
            }
            // The attach deadline, not this 100 ms read window, is what
            // bounds the arming.
            self.settle(CANCEL_POLL, cancel, deadline).await?;
        }
    }

    /// Navigates `session` to `url` and waits for the page to load and go
    /// quiet. A navigation the browser refuses is not fatal — the proxy may
    /// have denied it, which is the proxy doing its job — so the error is
    /// reported to the caller as `false` rather than failing the scan.
    async fn visit(
        &mut self,
        session: &SessionId,
        url: &str,
        cancel: &CancellationToken,
    ) -> Result<bool, CdpError> {
        self.load_fired = false;
        let params = to_params(&NavigateParams::new(url.to_string()))?;
        match self
            .call(
                Some(session.clone()),
                MethodId::from(NavigateParams::IDENTIFIER),
                params,
            )
            .await
        {
            Ok(_) => {}
            Err(CdpError::Protocol { .. }) => return Ok(false),
            Err(e) => return Err(e),
        }
        // Arming gets the whole load window, not one 100 ms read of it. A page
        // that attaches a burst of out-of-process iframes needs more than four
        // round trips' worth of budget, and a target left unarmed here is a
        // target left paused and therefore never run at all.
        let deadline = Instant::now() + LOAD_TIMEOUT;
        while !self.load_fired && !cancel.is_cancelled() && Instant::now() < deadline {
            self.settle(CANCEL_POLL, cancel, deadline).await?;
        }
        // The quiet period after load is short by design, but arming is not
        // held to it: a frame that attaches late still gets a full budget.
        self.settle(
            SETTLE_AFTER_LOAD,
            cancel,
            Instant::now() + ARM_DRAIN_BUDGET,
        )
        .await?;
        Ok(true)
    }

    /// The `href`s of the page's own anchors, already resolved to absolute
    /// URLs by the DOM.
    async fn links(&mut self, session: &SessionId) -> Result<Vec<String>, CdpError> {
        // The length filter runs **in the page**, before any of this becomes a
        // WebSocket frame. It has to: chromiumoxide's `Connection` is built
        // with `max_message_size: None, max_frame_size: None` (conn.rs:43-46),
        // so 500 anchors carrying a megabyte of `href` each would be one
        // ~500 MB frame buffered whole and then re-allocated again by
        // `serde_json`. Capping the count alone does not bound the bytes.
        let mut params = EvaluateParams::new(format!(
            "JSON.stringify(Array.from(document.querySelectorAll('a[href]'))\
             .map(function (a) {{ return String(a.href); }})\
             .filter(function (h) {{ return h.length <= {MAX_LINK_LEN}; }})\
             .slice(0, {MAX_LINKS_READ}))"
        ));
        params.return_by_value = Some(true);
        // The page is untrusted; an expression that throws must not pause it.
        params.silent = Some(true);
        let result = match self
            .call(
                Some(session.clone()),
                MethodId::from(EvaluateParams::IDENTIFIER),
                to_params(&params)?,
            )
            .await
        {
            Ok(result) => result,
            Err(CdpError::Protocol { .. }) => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let Some(json) = result
            .get("result")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
        else {
            return Ok(Vec::new());
        };
        Ok(serde_json::from_str::<Vec<String>>(json).unwrap_or_default())
    }

    async fn run(
        &mut self,
        entry_url: &str,
        max_pages: u32,
        cancel: &CancellationToken,
    ) -> Result<Observation, CdpError> {
        // F1/F2 on the browser session first, so the page target created below
        // attaches paused rather than running.
        self.call(
            None,
            MethodId::from(SetAutoAttachParams::IDENTIFIER),
            auto_attach_params()?,
        )
        .await?;
        self.arm_pending(cancel, Instant::now() + ARM_DRAIN_BUDGET)
            .await?;

        let created = self
            .call(
                None,
                MethodId::from(CreateTargetParams::IDENTIFIER),
                to_params(&CreateTargetParams::new("about:blank"))?,
            )
            .await?;
        let created: CreateTargetReturns = serde_json::from_value(created)
            .map_err(|e| CdpError::Serialisation(e.to_string()))?;
        let Some(session) = self.page_session(created.target_id.inner(), cancel).await? else {
            // Cancelled before the page even attached.
            return Ok(self.observation(0, true));
        };

        // `max_pages` counts the entry page, so a budget of zero loads
        // nothing rather than loading one page anyway.
        let mut pages_visited = 0u32;
        if cancel.is_cancelled() || max_pages == 0 {
            return Ok(self.observation(pages_visited, cancel.is_cancelled()));
        }
        if self.visit(&session, entry_url, cancel).await? {
            pages_visited += 1;
        }

        if cancel.is_cancelled() || max_pages <= 1 {
            return Ok(self.observation(pages_visited, cancel.is_cancelled()));
        }
        let hrefs = self.links(&session).await?;
        let refs: Vec<&str> = hrefs.iter().map(|s| s.as_str()).collect();
        let follow = same_origin_links(entry_url, &refs, (max_pages - 1) as usize);
        for url in follow {
            if cancel.is_cancelled() {
                break;
            }
            if self.visit(&session, &url, cancel).await? {
                pages_visited += 1;
            }
        }
        Ok(self.observation(pages_visited, cancel.is_cancelled()))
    }

    fn observation(&mut self, pages_visited: u32, stopped_early: bool) -> Observation {
        // The one place that decides nothing more will be retried, and so the
        // one place anything still queued becomes a gap rather than a deferral.
        self.abandon_pending();
        if self.acc.overflowed() {
            // The host list stopped growing, so it is known to be incomplete.
            // One place, standing for everything past the cap.
            self.gaps.note("hosts:limit");
        }
        Observation {
            hosts: std::mem::take(&mut self.acc).finish(),
            pages_visited,
            possible_gaps: self.gaps.count(),
            stopped_early,
        }
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// Attaches to the browser `launched`, loads `entry_url` and up to
/// `max_pages` pages of the same origin, and reports which hosts they
/// contacted.
///
/// Never panics, and never constructs a `chromiumoxide::Browser` or `Handler`:
/// both resume an attached target immediately with nothing armed in it
/// (preflight §1), which is the exact race this sequence exists to close.
/// Staying off `Browser` also keeps `reqwest`/`hyper` off every live path.
///
/// On cancellation this returns what has been collected so far and leaves
/// teardown to the caller — `Launched` kills the process and removes the
/// profile on drop.
pub async fn observe(
    launched: &Launched,
    entry_url: &str,
    max_pages: u32,
    cancel: CancellationToken,
) -> Result<Observation, CdpError> {
    let ws_url = browser_ws_url(launched).await?;
    let connection = Connection::<CdpJsonEventMessage>::connect(&ws_url)
        .await
        .map_err(|e| CdpError::Connect(e.to_string()))?;
    let mut driver = Driver::new(connection);
    driver.run(entry_url, max_pages, &cancel).await
}

/// Waits, bounded, for `DevToolsActivePort` and builds the browser-level
/// WebSocket URL from it.
async fn browser_ws_url(launched: &Launched) -> Result<String, CdpError> {
    let path = launched.profile_dir.join("DevToolsActivePort");
    // Fixed before the loop, so no amount of slow writing moves it.
    let deadline = Instant::now() + DEVTOOLS_FILE_TIMEOUT;
    loop {
        // A tiny read of a local file this process's own launch created. Not
        // `tokio::fs`, which would only move the same read onto a blocking
        // thread; it is microseconds, and the alternative is another feature
        // on the dependency budget.
        match std::fs::read_to_string(&path) {
            Ok(contents) => return ws_url_from_devtools_file(&contents, launched.devtools_port),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if !launched.profile_dir.is_dir() {
                    return Err(CdpError::ProfileGone(launched.profile_dir.clone()));
                }
            }
            Err(e) => return Err(CdpError::DevToolsPortUnreadable(e)),
        }
        if Instant::now() >= deadline {
            return Err(CdpError::DevToolsPortMissing);
        }
        tokio::time::sleep(DEVTOOLS_FILE_POLL).await;
    }
}

/// Builds `ws://127.0.0.1:<port><path>` from the two lines of
/// `DevToolsActivePort`.
///
/// The file contributes exactly one thing: the opaque browser target path.
/// The host is hardcoded loopback and the port must equal the one this
/// process's own launch already observed, so a file planted by another local
/// process — which would first have to get inside a 0700 directory created
/// without following symlinks (see `browser.rs`) — cannot redirect this
/// connection somewhere else. The path is character-restricted for the same
/// reason: nothing in it may introduce a host, a query, or a second URL.
fn ws_url_from_devtools_file(contents: &str, expected_port: u16) -> Result<String, CdpError> {
    let mut lines = contents.lines();
    let port = lines
        .next()
        .and_then(|line| line.trim().parse::<u16>().ok())
        .ok_or_else(|| CdpError::DevToolsPortMalformed(contents.to_string()))?;
    if port != expected_port {
        return Err(CdpError::DevToolsPortMalformed(contents.to_string()));
    }
    let path = lines.next().map(str::trim).unwrap_or_default();
    let acceptable = path.starts_with("/devtools/browser/")
        && path.len() <= 128
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_'));
    if !acceptable {
        return Err(CdpError::DevToolsPortMalformed(contents.to_string()));
    }
    Ok(format!("ws://127.0.0.1:{port}{path}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_repeat_requests_to_one_host_once_as_a_host() {
        let mut acc = HostAccumulator::new();
        acc.record("https://www.google-analytics.com/collect?v=1");
        acc.record("https://www.google-analytics.com/collect?v=2");
        acc.record("https://doubleclick.net/pixel.gif");
        let hosts = acc.finish();
        assert_eq!(hosts.len(), 2);
        let ga = hosts
            .iter()
            .find(|h| h.host == "www.google-analytics.com")
            .expect("ga");
        assert_eq!(ga.request_count, 2);
    }

    #[test]
    fn lowercases_hosts_so_one_host_is_not_counted_twice() {
        let mut acc = HostAccumulator::new();
        acc.record("https://WWW.Example.COM/a");
        acc.record("https://www.example.com/b");
        assert_eq!(acc.finish().len(), 1);
    }

    #[test]
    fn ignores_a_url_with_no_host() {
        let mut acc = HostAccumulator::new();
        for u in [
            "data:text/css,body{}",
            "about:blank",
            "",
            "not a url",
            "blob:https://x/y",
        ] {
            acc.record(u);
        }
        assert!(acc.finish().is_empty());
    }

    #[test]
    fn strips_the_port_and_userinfo_from_a_host() {
        let mut acc = HostAccumulator::new();
        acc.record("https://user:pw@example.com:8443/x");
        let hosts = acc.finish();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host, "example.com");
    }

    #[test]
    fn returns_hosts_in_a_stable_order() {
        // A map that reorders itself between runs is not trustworthy, and the
        // same is true of the list it is built from.
        let mut a = HostAccumulator::new();
        for u in [
            "https://b.example/1",
            "https://a.example/1",
            "https://c.example/1",
        ] {
            a.record(u);
        }
        let mut b = HostAccumulator::new();
        for u in [
            "https://c.example/1",
            "https://a.example/1",
            "https://b.example/1",
        ] {
            b.record(u);
        }
        let names_a: Vec<_> = a.finish().into_iter().map(|h| h.host).collect();
        let names_b: Vec<_> = b.finish().into_iter().map(|h| h.host).collect();
        assert_eq!(names_a, names_b);
    }

    #[test]
    fn same_origin_links_are_followed_and_others_are_not() {
        let links = [
            "https://rossi-editore.it/about",
            "https://rossi-editore.it/contact",
            "https://www.rossi-editore.it/other",
            "https://facebook.com/rossi",
            "mailto:info@rossi-editore.it",
            "javascript:void(0)",
            "#anchor",
        ];
        let next = same_origin_links("https://rossi-editore.it/", &links, 10);
        assert_eq!(
            next,
            vec![
                "https://rossi-editore.it/about",
                "https://rossi-editore.it/contact"
            ]
        );
    }

    #[test]
    fn never_follows_more_than_the_page_limit() {
        let links: Vec<String> = (0..50)
            .map(|i| format!("https://rossi-editore.it/{i}"))
            .collect();
        let refs: Vec<&str> = links.iter().map(|s| s.as_str()).collect();
        assert_eq!(
            same_origin_links("https://rossi-editore.it/", &refs, 10).len(),
            10
        );
    }

    #[test]
    fn does_not_follow_the_entry_page_again() {
        let next = same_origin_links(
            "https://rossi-editore.it/",
            &["https://rossi-editore.it/", "https://rossi-editore.it/a"],
            10,
        );
        assert_eq!(next, vec!["https://rossi-editore.it/a"]);
    }

    // --- Tests added beyond the brief ---
    //
    // The brief's eight cover the two pure helpers. They do not cover the two
    // properties this task exists for — F1's recursive `flatten` auto-attach
    // and F2's arm-before-resume — and a comment claiming those is not
    // evidence. Everything below observes the commands the driver actually
    // submits, through a fake transport that also refuses to accept a second
    // command while one is unanswered. Nothing here opens a socket, resolves a
    // name, or launches a browser.

    use serde_json::json;
    use std::collections::HashMap;

    /// Records every submit in order, answers each one, and injects events on
    /// demand. Its two assertions *are* the test of the ordering guarantee:
    /// only one command may be outstanding, and its response must be consumed
    /// before the next command is sent.
    struct FakeTransport {
        sent: Vec<(String, Option<String>, serde_json::Value)>,
        inbox: VecDeque<Message<CdpJsonEventMessage>>,
        in_flight: Option<CallId>,
        next_id: usize,
        /// Canned `result` payloads by method name.
        results: HashMap<String, serde_json::Value>,
        /// Events emitted immediately before the response to a matching
        /// (method, session) submit — i.e. while that command is in flight.
        inject: Vec<(String, Option<String>, CdpJsonEventMessage)>,
        /// (method, session) pairs answered with a CDP error rather than a
        /// result — a browser refusing a command.
        refuse: Vec<(String, Option<String>)>,
        /// When false, a submit is recorded but never answered: a browser that
        /// died mid-scan.
        answers: bool,
        /// When true, an empty inbox blocks forever instead of ending the
        /// stream — a live browser with nothing to say, which is what lets a
        /// test drive `settle` and watch its read time out.
        hang_when_empty: bool,
    }

    impl FakeTransport {
        fn new() -> Self {
            Self {
                sent: Vec::new(),
                inbox: VecDeque::new(),
                in_flight: None,
                next_id: 0,
                results: HashMap::new(),
                inject: Vec::new(),
                refuse: Vec::new(),
                answers: true,
                hang_when_empty: false,
            }
        }

        fn refuse_on(&mut self, method: &str, session: Option<&str>) {
            self.refuse
                .push((method.to_string(), session.map(str::to_string)));
        }

        fn dead() -> Self {
            Self {
                answers: false,
                ..Self::new()
            }
        }

        fn inject_on(&mut self, method: &str, session: Option<&str>, event: CdpJsonEventMessage) {
            self.inject.push((
                method.to_string(),
                session.map(str::to_string),
                event,
            ));
        }

        fn methods_for(&self, session: Option<&str>) -> Vec<&str> {
            self.sent
                .iter()
                .filter(|(_, s, _)| s.as_deref() == session)
                .map(|(m, _, _)| m.as_str())
                .collect()
        }

        fn params_for(&self, method: &str, session: Option<&str>) -> Option<&serde_json::Value> {
            self.sent
                .iter()
                .find(|(m, s, _)| m == method && s.as_deref() == session)
                .map(|(_, _, p)| p)
        }
    }

    impl CdpTransport for FakeTransport {
        fn submit(
            &mut self,
            method: MethodId,
            session: Option<SessionId>,
            params: serde_json::Value,
        ) -> Result<CallId, CdpError> {
            assert!(
                self.in_flight.is_none(),
                "{method} was sent while an earlier command was still unanswered — \
                 the arm-before-resume ordering only holds if each response is awaited"
            );
            let session_str = session.as_ref().map(|s| s.inner().clone());
            self.sent
                .push((method.to_string(), session_str.clone(), params));

            let id = CallId::new(self.next_id);
            self.next_id += 1;
            if !self.answers {
                return Ok(id);
            }
            let mut remaining = Vec::new();
            for (m, s, event) in std::mem::take(&mut self.inject) {
                if m == method.as_ref() && s == session_str {
                    self.inbox.push_back(Message::Event(event));
                } else {
                    remaining.push((m, s, event));
                }
            }
            self.inject = remaining;
            let refused = self
                .refuse
                .iter()
                .any(|(m, s)| m == method.as_ref() && *s == session_str);
            self.inbox
                .push_back(Message::Response(chromiumoxide::types::Response {
                    id,
                    result: if refused {
                        None
                    } else {
                        Some(
                            self.results
                                .get(method.as_ref())
                                .cloned()
                                .unwrap_or_else(|| json!({})),
                        )
                    },
                    error: refused.then(|| chromiumoxide::types::Error {
                        code: -32000,
                        message: format!("{method} is not available on this target"),
                    }),
                }));
            self.in_flight = Some(id);
            Ok(id)
        }

        async fn recv(&mut self) -> Option<Result<Message<CdpJsonEventMessage>, CdpError>> {
            if self.inbox.is_empty() && self.hang_when_empty {
                std::future::pending::<()>().await;
            }
            let message = self.inbox.pop_front()?;
            if let Message::Response(_) = &message {
                self.in_flight = None;
            }
            Some(Ok(message))
        }
    }

    /// A deadline far enough out that the arming budget is not what a test is
    /// measuring. Tests that *do* measure it pass their own.
    fn far_future() -> Instant {
        Instant::now() + Duration::from_secs(3600)
    }

    fn attached_event(session: &str, target: &str, kind: &str, waiting: bool) -> CdpJsonEventMessage
    {
        CdpJsonEventMessage {
            method: MethodId::from(EventAttachedToTarget::IDENTIFIER),
            session_id: None,
            params: json!({
                "sessionId": session,
                "waitingForDebugger": waiting,
                "targetInfo": {
                    "targetId": target,
                    "type": kind,
                    "title": "",
                    "url": "about:blank",
                    "attached": true,
                    "canAccessOpener": false,
                },
            }),
        }
    }

    const ARMED_THEN_RESUMED: [&str; 4] = [
        "Network.enable",
        "Page.enable",
        "Target.setAutoAttach",
        "Runtime.runIfWaitingForDebugger",
    ];

    #[test]
    fn nothing_is_resumed_before_observation_and_recursion_are_armed() {
        let steps = arming_sequence(true).expect("sequence");
        let names: Vec<&str> = steps.iter().map(|(m, _, _)| m.as_ref()).collect();
        assert_eq!(names, ARMED_THEN_RESUMED);
        // Stated as a property as well as an equality, so a future edit that
        // adds a step cannot quietly move the resume out of last place.
        assert_eq!(
            names.last().copied(),
            Some("Runtime.runIfWaitingForDebugger")
        );
    }

    #[test]
    fn a_target_that_is_not_waiting_is_not_resumed() {
        let steps = arming_sequence(false).expect("sequence");
        let names: Vec<&str> = steps.iter().map(|(m, _, _)| m.as_ref()).collect();
        assert!(!names.contains(&"Runtime.runIfWaitingForDebugger"), "{names:?}");
    }

    #[test]
    fn only_a_step_whose_failure_hides_a_vendor_is_treated_as_a_gap() {
        // The split exists so that neither mistake is possible: a worker with
        // no Page domain is not a gap, and a target running unobserved is not
        // something to swallow. Pinned so a later "simplification" back to one
        // tolerant path fails here.
        let steps = arming_sequence(true).expect("sequence");
        let classified: Vec<(&str, OnFailure)> =
            steps.iter().map(|(m, _, f)| (m.as_ref(), *f)).collect();
        assert_eq!(
            classified,
            vec![
                ("Network.enable", OnFailure::LosesObservation),
                ("Page.enable", OnFailure::Expected),
                ("Target.setAutoAttach", OnFailure::LosesObservation),
                (
                    "Runtime.runIfWaitingForDebugger",
                    OnFailure::Expected
                ),
            ]
        );
    }

    #[test]
    fn every_auto_attach_asks_for_flatten_and_for_the_pause() {
        // F1 and F2 in one command. Without `flatten` a cross-origin iframe's
        // session is not addressable and its trackers are invisible; without
        // `waitForDebuggerOnStart` there is no window in which to arm.
        let params = auto_attach_params().expect("params");
        assert_eq!(params["flatten"], json!(true));
        assert_eq!(params["autoAttach"], json!(true));
        assert_eq!(params["waitForDebuggerOnStart"], json!(true));
    }

    #[tokio::test]
    async fn arms_the_child_session_on_the_wire_before_resuming_it() {
        // Not "the sequence says so" — what was actually submitted, in order,
        // addressed to the child's own session id.
        let mut driver = Driver::new(FakeTransport::new());
        driver.on_event(attached_event("SESSION-A", "T-A", "page", true));
        driver.arm_pending(&CancellationToken::new(), far_future()).await.expect("arm");

        assert_eq!(driver.transport.methods_for(Some("SESSION-A")), ARMED_THEN_RESUMED);
        assert_eq!(
            driver
                .transport
                .params_for("Target.setAutoAttach", Some("SESSION-A"))
                .and_then(|p| p.get("flatten")),
            Some(&json!(true))
        );
    }

    #[tokio::test]
    async fn a_frame_that_attaches_during_arming_is_itself_armed_and_resumed() {
        // The recursion, which is this module's own and has no library
        // behaviour behind it: the child's `setAutoAttach` is what causes the
        // grandchild to attach, and the grandchild must get the same four
        // commands. This is where a cross-origin iframe's ad-tech lives.
        let mut transport = FakeTransport::new();
        transport.inject_on(
            "Target.setAutoAttach",
            Some("SESSION-A"),
            attached_event("SESSION-B", "T-B", "iframe", true),
        );
        transport.inject_on(
            "Target.setAutoAttach",
            Some("SESSION-B"),
            attached_event("SESSION-C", "T-C", "iframe", true),
        );
        let mut driver = Driver::new(transport);
        driver.on_event(attached_event("SESSION-A", "T-A", "page", true));
        driver.arm_pending(&CancellationToken::new(), far_future()).await.expect("arm");

        for session in ["SESSION-A", "SESSION-B", "SESSION-C"] {
            assert_eq!(
                driver.transport.methods_for(Some(session)),
                ARMED_THEN_RESUMED,
                "{session} was not armed"
            );
        }
    }

    #[tokio::test]
    async fn a_target_that_refuses_network_enable_is_counted_and_still_resumed() {
        // The gap must be visible, not silent: this target ran without this
        // module able to see what it contacted, and the count is how the map
        // gets to say so. It must still be resumed — a target left waiting on
        // the debugger hangs the scan, which is worse than a counted gap.
        let mut transport = FakeTransport::new();
        transport.refuse_on("Network.enable", Some("SESSION-A"));
        let mut driver = Driver::new(transport);
        driver.on_event(attached_event("SESSION-A", "T-A", "iframe", true));
        driver.arm_pending(&CancellationToken::new(), far_future()).await.expect("arming is not a scan failure");

        assert_eq!(driver.observation(1, false).possible_gaps, 1);
        assert_eq!(
            driver.transport.methods_for(Some("SESSION-A")),
            ARMED_THEN_RESUMED,
            "every later step, above all the resume, must still be sent"
        );
    }

    #[tokio::test]
    async fn a_worker_without_a_page_domain_is_not_counted_as_a_gap() {
        // The paired control. Without it the requirement is met by counting
        // every refusal, which would report a gap on every ordinary scan and
        // make the number worthless.
        let mut transport = FakeTransport::new();
        transport.refuse_on("Page.enable", Some("SESSION-W"));
        let mut driver = Driver::new(transport);
        driver.on_event(attached_event("SESSION-W", "T-W", "worker", true));
        driver.arm_pending(&CancellationToken::new(), far_future()).await.expect("arm");

        assert_eq!(driver.observation(1, false).possible_gaps, 0);
        assert_eq!(
            driver.transport.methods_for(Some("SESSION-W")),
            ARMED_THEN_RESUMED
        );
    }

    #[tokio::test]
    async fn a_target_with_two_failed_steps_is_one_gap_not_two() {
        // The number counts targets with a gap, not failed commands.
        let mut transport = FakeTransport::new();
        transport.refuse_on("Network.enable", Some("SESSION-A"));
        transport.refuse_on("Target.setAutoAttach", Some("SESSION-A"));
        let mut driver = Driver::new(transport);
        driver.on_event(attached_event("SESSION-A", "T-A", "iframe", true));
        driver.arm_pending(&CancellationToken::new(), far_future()).await.expect("arm");
        assert_eq!(driver.observation(1, false).possible_gaps, 1);
    }

    #[tokio::test]
    async fn a_browser_that_stops_answering_fails_the_scan_rather_than_shortening_it() {
        // A partial host list reported as a finished scan is the wrong answer
        // this release exists to avoid.
        let mut driver = Driver::new(FakeTransport::dead());
        driver.on_event(attached_event("SESSION-A", "T-A", "page", true));
        let err = driver.arm_pending(&CancellationToken::new(), far_future()).await.expect_err("must not succeed");
        assert!(matches!(err, CdpError::BrowserGone), "{err:?}");
    }

    #[tokio::test]
    async fn cancelling_returns_what_was_collected_rather_than_an_error() {
        let mut transport = FakeTransport::new();
        transport
            .results
            .insert("Target.createTarget".to_string(), json!({"targetId": "T-1"}));
        transport.inject_on(
            "Target.createTarget",
            None,
            attached_event("SESSION-A", "T-1", "page", true),
        );
        let mut driver = Driver::new(transport);
        let cancel = CancellationToken::new();
        cancel.cancel();

        let observation = driver
            .run("https://rossi-editore.it/", 10, &cancel)
            .await
            .expect("cancellation is not a failure");
        assert_eq!(observation.pages_visited, 0);
        assert!(driver.transport.methods_for(Some("SESSION-A")).is_empty());
        // And it says so. A scan stopped before its page was even armed has a
        // target it never looked inside, and that is a place the map may be
        // incomplete — reporting zero gaps here would be the silent absence
        // this whole mechanism exists to prevent.
        assert!(
            observation.possible_gaps >= 1,
            "an abandoned target must be counted: {observation:?}"
        );
        // And it is distinguishable from a completed scan that happens to have
        // holes. Without this flag, Task 9 would show a user who just pressed
        // Stop the same warning it shows a user whose finished map is
        // incomplete — which teaches them to ignore it.
        assert!(observation.stopped_early);
    }

    #[tokio::test]
    async fn a_scan_that_finished_does_not_claim_to_have_been_stopped() {
        // The paired control for the flag above.
        let mut transport = FakeTransport::new();
        transport
            .results
            .insert("Target.createTarget".to_string(), json!({"targetId": "T-1"}));
        transport.inject_on(
            "Target.createTarget",
            None,
            attached_event("SESSION-A", "T-1", "page", true),
        );
        let mut driver = Driver::new(transport);
        let observation = driver
            .run("https://rossi-editore.it/", 0, &CancellationToken::new())
            .await
            .expect("run");
        assert!(!observation.stopped_early);
    }

    #[tokio::test]
    async fn a_page_budget_of_zero_loads_nothing() {
        // `max_pages` counts the entry page. Zero must not quietly mean one.
        let mut transport = FakeTransport::new();
        transport
            .results
            .insert("Target.createTarget".to_string(), json!({"targetId": "T-1"}));
        transport.inject_on(
            "Target.createTarget",
            None,
            attached_event("SESSION-A", "T-1", "page", true),
        );
        let mut driver = Driver::new(transport);
        let observation = driver
            .run("https://rossi-editore.it/", 0, &CancellationToken::new())
            .await
            .expect("run");
        assert_eq!(observation.pages_visited, 0);
        assert!(!driver
            .transport
            .methods_for(Some("SESSION-A"))
            .contains(&"Page.navigate"));
    }

    // --- Directed by the security audit ---

    #[tokio::test]
    async fn an_attach_event_that_does_not_parse_is_counted_and_still_resumed() {
        // C-1. `TargetInfo` declares title/url/attached/canAccessOpener as
        // non-optional and Task 6 launches whichever Chrome or Edge is on the
        // machine, unpinned. One browser build that omits `canAccessOpener`
        // must not make every out-of-process iframe vanish while the scan
        // reports a clean map.
        let mut driver = Driver::new(FakeTransport::new());
        driver.on_event(CdpJsonEventMessage {
            method: MethodId::from(EventAttachedToTarget::IDENTIFIER),
            session_id: None,
            params: json!({
                "sessionId": "SESSION-ODD",
                "waitingForDebugger": true,
                "targetInfo": {
                    "targetId": "T-ODD",
                    "type": "iframe",
                    "title": "",
                    "url": "about:blank",
                    "attached": true,
                    // canAccessOpener deliberately absent.
                },
            }),
        });
        driver
            .arm_pending(&CancellationToken::new(), far_future())
            .await
            .expect("an unparseable attach is not a scan failure");

        assert_eq!(
            driver.observation(1, false).possible_gaps,
            1,
            "a target that could not be understood is a place the map may be incomplete"
        );
        // It cannot be armed — nothing here knows what it is — but it must not
        // be left paused for the life of the scan.
        assert_eq!(
            driver.transport.methods_for(Some("SESSION-ODD")),
            vec!["Runtime.runIfWaitingForDebugger"]
        );
    }

    #[tokio::test]
    async fn an_attach_event_with_no_readable_session_is_still_counted() {
        // Nothing can be sent to it, so all that is left is to say the map has
        // a hole in it rather than to drop the event on the floor.
        let mut driver = Driver::new(FakeTransport::new());
        driver.on_event(CdpJsonEventMessage {
            method: MethodId::from(EventAttachedToTarget::IDENTIFIER),
            session_id: None,
            params: json!({"waitingForDebugger": true}),
        });
        assert_eq!(driver.observation(1, false).possible_gaps, 1);
    }

    #[tokio::test]
    async fn arming_during_a_page_load_gets_the_loads_budget_not_the_read_window() {
        // New-1, the other half. `settle` is called with a 100 ms `duration` —
        // that is `CANCEL_POLL`, which bounds how long a single *read* may
        // block. An earlier version handed that same 100 ms to `arm_pending`
        // as the arming budget, and since arming one target is four round
        // trips, every drain during a page load expired before it started.
        //
        // Driven with a transport that blocks on an empty inbox, so the read
        // really does consume the whole window, which is what makes the two
        // deadlines distinguishable.
        let mut transport = FakeTransport::new();
        transport.hang_when_empty = true;
        let mut driver = Driver::new(transport);
        for i in 0..3 {
            driver.on_event(attached_event(
                &format!("SESSION-{i}"),
                &format!("T-{i}"),
                "iframe",
                true,
            ));
        }

        driver
            .settle(CANCEL_POLL, &CancellationToken::new(), far_future())
            .await
            .expect("settle");

        for i in 0..3 {
            assert_eq!(
                driver.transport.methods_for(Some(&format!("SESSION-{i}"))),
                ARMED_THEN_RESUMED,
                "SESSION-{i} was starved by the read window"
            );
        }
    }

    #[tokio::test]
    async fn a_queue_that_does_not_drain_in_one_window_is_retried_in_the_next() {
        // New-1. The window that ends a drain must defer, not abandon. An
        // abandoned target stays paused by this module's own
        // `waitForDebuggerOnStart`, so it never runs and never issues a
        // request — which means the proxy ledger never sees its vendors
        // either. Dropping the queue does not lose the view of a frame, it
        // stops the frame existing.
        let mut driver = Driver::new(FakeTransport::new());
        for i in 0..3 {
            driver.on_event(attached_event(
                &format!("SESSION-{i}"),
                &format!("T-{i}"),
                "iframe",
                true,
            ));
        }
        // First window: already expired, so nothing is armed.
        driver
            .arm_pending(&CancellationToken::new(), Instant::now() - Duration::from_secs(1))
            .await
            .expect("a spent window is not a scan failure");
        assert!(driver.transport.sent.is_empty());
        assert_eq!(
            driver.pending_attach.len(),
            3,
            "the queue must survive the window, not be drained into the gap counter"
        );

        // Next window: everything is armed, and nothing is reported as a gap.
        driver
            .arm_pending(&CancellationToken::new(), far_future())
            .await
            .expect("arm");
        for i in 0..3 {
            assert_eq!(
                driver.transport.methods_for(Some(&format!("SESSION-{i}"))),
                ARMED_THEN_RESUMED
            );
        }
        assert_eq!(driver.observation(1, false).possible_gaps, 0);
    }

    #[tokio::test]
    async fn arming_stops_at_its_deadline_and_counts_what_it_abandoned() {
        // I-1. A page can enqueue attachments faster than four round-trips
        // each can drain them. The scan must stay finite and say what it
        // skipped.
        let mut driver = Driver::new(FakeTransport::new());
        for i in 0..5 {
            driver.on_event(attached_event(
                &format!("SESSION-{i}"),
                &format!("T-{i}"),
                "iframe",
                true,
            ));
        }
        // A deadline already in the past: nothing may be armed.
        let past = Instant::now() - Duration::from_secs(1);
        driver
            .arm_pending(&CancellationToken::new(), past)
            .await
            .expect("hitting the budget is not a scan failure");

        assert!(driver.transport.sent.is_empty(), "nothing should have been armed");
        assert_eq!(
            driver.observation(1, false).possible_gaps,
            5,
            "every abandoned target is a place the map may be incomplete"
        );
    }

    #[tokio::test]
    async fn cancelling_stops_arming_between_targets() {
        let mut driver = Driver::new(FakeTransport::new());
        for i in 0..3 {
            driver.on_event(attached_event(
                &format!("SESSION-{i}"),
                &format!("T-{i}"),
                "iframe",
                true,
            ));
        }
        let cancel = CancellationToken::new();
        cancel.cancel();
        driver
            .arm_pending(&cancel, far_future())
            .await
            .expect("cancellation is not a scan failure");
        assert!(driver.transport.sent.is_empty());
        assert_eq!(driver.observation(1, false).possible_gaps, 3);
    }

    #[tokio::test]
    async fn one_target_reattaching_and_failing_twice_is_one_gap() {
        // M-3. Chrome re-issues attachedToTarget for the same target when it
        // navigates cross-process. Two events, one frame, one gap.
        let mut transport = FakeTransport::new();
        transport.refuse_on("Network.enable", Some("SESSION-A1"));
        transport.refuse_on("Network.enable", Some("SESSION-A2"));
        let mut driver = Driver::new(transport);
        driver.on_event(attached_event("SESSION-A1", "T-A", "iframe", true));
        driver.on_event(attached_event("SESSION-A2", "T-A", "iframe", true));
        driver
            .arm_pending(&CancellationToken::new(), far_future())
            .await
            .expect("arm");
        assert_eq!(driver.observation(1, false).possible_gaps, 1);
    }

    #[tokio::test]
    async fn caps_the_length_of_each_href_inside_the_page() {
        // New-3. The filter runs in the page, before any of this becomes a
        // WebSocket frame — chromiumoxide's Connection sets max_frame_size to
        // None, so capping the *count* of hrefs does not bound the bytes. The
        // realistic regression is the filter being deleted, and this catches
        // that.
        let mut transport = FakeTransport::new();
        transport.results.insert(
            "Runtime.evaluate".to_string(),
            json!({"result": {"value": "[]"}}),
        );
        let mut driver = Driver::new(transport);
        driver
            .links(&SessionId::from("SESSION-A".to_string()))
            .await
            .expect("links");

        let expression = driver
            .transport
            .params_for("Runtime.evaluate", Some("SESSION-A"))
            .and_then(|p| p.get("expression"))
            .and_then(|e| e.as_str())
            .expect("an expression was submitted");
        assert!(
            expression.contains(&format!("h.length <= {MAX_LINK_LEN}")),
            "the per-href length filter is gone: {expression}"
        );
        assert!(
            expression.contains(&format!("slice(0, {MAX_LINKS_READ})")),
            "the href count cap is gone: {expression}"
        );
    }

    #[test]
    fn refuses_a_host_that_is_not_the_shape_a_host_can_be() {
        // New-4. Matching admission.rs::vet_host. Without it, up to 253 bytes
        // of arbitrary text reach ObservedHost.host and travel on to the
        // renderer and the saved project file — including a Unicode homograph
        // of a real vendor's name. Rejected, not sanitised.
        let mut acc = HostAccumulator::new();
        for bad in [
            "https://exa\u{0301}mple.com/x",     // combining accent, non-ASCII
            "https://gooğle-analytics.com/x",     // homograph
            "https://ex\namp.le/x",               // newline
            "https://ex\u{0000}ample.com/x",      // NUL
            "https://ex ample.com/x",             // space
            "https://exa_mple.com/x",             // underscore is not a host character
            "https://..example.com/x",            // empty label
            "https://.example.com/x",             // leading dot
        ] {
            acc.record(bad);
        }
        assert!(acc.finish().is_empty());

        // Paired controls: the shapes that must still work.
        let mut acc = HostAccumulator::new();
        for good in [
            "https://www.google-analytics.com/x",
            "https://192.0.2.4/x",
            "https://[2001:db8::1]:8443/x",
            "https://[::1]/x",
        ] {
            acc.record(good);
        }
        assert_eq!(acc.finish().len(), 4);
    }

    #[test]
    fn refuses_a_host_longer_than_a_domain_name_can_be() {
        // I-2. Network.requestWillBeSent fires *before* the proxy refuses
        // anything, so the host in it is attacker-chosen data on its way into
        // the map, the renderer and the project file.
        let long = "a".repeat(3_000_000);
        let mut acc = HostAccumulator::new();
        acc.record(&format!("https://{long}.example/x"));
        assert!(acc.finish().is_empty());
        // The paired control: 253 bytes is the DNS limit and must still work.
        let mut acc = HostAccumulator::new();
        acc.record(&format!("https://{}/x", "b".repeat(253)));
        assert_eq!(acc.finish().len(), 1);
    }

    #[test]
    fn stops_taking_new_hosts_at_the_limit_and_says_so() {
        let mut acc = HostAccumulator::new();
        for i in 0..(MAX_HOSTS + 10) {
            acc.record(&format!("https://h{i}.example/x"));
        }
        assert!(acc.overflowed(), "the overflow must be visible, not silent");
        assert_eq!(acc.finish().len(), MAX_HOSTS);
    }

    #[tokio::test]
    async fn a_host_list_that_hit_its_limit_is_reported_as_a_possible_gap() {
        let mut driver = Driver::new(FakeTransport::new());
        for i in 0..(MAX_HOSTS + 1) {
            driver.acc.record(&format!("https://h{i}.example/x"));
        }
        assert_eq!(driver.observation(1, false).possible_gaps, 1);
    }

    #[test]
    fn strips_one_trailing_dot_so_the_host_matches_the_proxy_ledger() {
        // I-3. admission.rs strips exactly one trailing dot and the ledger
        // lowercases. A host recorded here as "example.com." would split its
        // count against the undotted form and miss Task 9's dictionary.
        let mut acc = HostAccumulator::new();
        acc.record("https://www.google-analytics.com./collect");
        acc.record("https://www.google-analytics.com/collect");
        let hosts = acc.finish();
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host, "www.google-analytics.com");
        assert_eq!(hosts[0].request_count, 2);
    }

    #[test]
    fn a_page_limit_of_zero_follows_nothing() {
        // M-1. Unreachable from `run` today, but the function's contract says
        // "truncated to limit" and a caller passing a computed budget must be
        // able to trust it.
        assert!(same_origin_links(
            "https://rossi-editore.it/",
            &["https://rossi-editore.it/a"],
            0
        )
        .is_empty());
    }

    #[test]
    fn a_default_port_does_not_make_a_second_origin() {
        // M-4. https://x.example:443/b is the same origin as https://x.example/b.
        let next = same_origin_links(
            "https://rossi-editore.it/",
            &[
                "https://rossi-editore.it:443/b",
                "http://rossi-editore.it:80/c",
                "https://rossi-editore.it.:443/d",
            ],
            10,
        );
        // The http:80 link is a different *scheme* and still must not be
        // followed; the other two are this origin.
        assert_eq!(
            next,
            vec![
                "https://rossi-editore.it:443/b",
                "https://rossi-editore.it.:443/d"
            ]
        );
        // And a genuinely different port is still a different origin.
        assert!(same_origin_links(
            "https://rossi-editore.it/",
            &["https://rossi-editore.it:8443/b"],
            10
        )
        .is_empty());
    }

    #[test]
    fn counting_one_host_forever_does_not_overflow() {
        // M-2. The module's doc says it never panics; unchecked u32 arithmetic
        // on a page-driven counter would make that untrue in a debug build.
        let mut acc = HostAccumulator::new();
        acc.counts.insert("x.example".to_string(), u32::MAX);
        acc.record("https://x.example/a");
        assert_eq!(acc.finish()[0].request_count, u32::MAX);
    }

    #[test]
    fn attributes_a_request_to_the_host_that_received_it() {
        let mut driver = Driver::new(FakeTransport::new());
        driver.on_event(CdpJsonEventMessage {
            method: MethodId::from(EventRequestWillBeSent::IDENTIFIER),
            session_id: None,
            params: json!({"request": {"url": "https://www.google-analytics.com/collect"}}),
        });
        let hosts = driver.observation(1, false).hosts;
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].host, "www.google-analytics.com");
    }

    #[test]
    fn builds_the_websocket_url_from_the_two_lines_of_the_port_file() {
        assert_eq!(
            ws_url_from_devtools_file("54321\n/devtools/browser/abc-123_x\n", 54321)
                .expect("url"),
            "ws://127.0.0.1:54321/devtools/browser/abc-123_x"
        );
    }

    #[test]
    fn refuses_a_port_file_that_does_not_name_the_port_this_process_launched() {
        // The only thing the file is trusted for is the opaque browser path.
        let err = ws_url_from_devtools_file("9222\n/devtools/browser/abc", 54321);
        assert!(matches!(err, Err(CdpError::DevToolsPortMalformed(_))), "{err:?}");
    }

    #[test]
    fn refuses_a_port_file_whose_second_line_is_not_a_browser_target_path() {
        for contents in [
            "54321",
            "54321\n",
            "54321\nhttp://evil.example/devtools/browser/abc",
            "54321\n/devtools/browser/abc?x=1",
            "54321\n//evil.example/devtools/browser/abc",
            "54321\n/devtools/page/abc",
            "54321\n/devtools/browser/a b",
            "not-a-port\n/devtools/browser/abc",
        ] {
            let err = ws_url_from_devtools_file(contents, 54321);
            assert!(
                matches!(err, Err(CdpError::DevToolsPortMalformed(_))),
                "should have been refused: {contents:?} gave {err:?}"
            );
        }
    }

    #[test]
    fn does_not_spend_two_pages_on_one_document() {
        // A page that links the same URL twice, or links both the bare origin
        // and its root, would otherwise burn the page budget on one document.
        let next = same_origin_links(
            "https://rossi-editore.it/entry",
            &[
                "https://rossi-editore.it/a",
                "https://rossi-editore.it/a",
                "https://rossi-editore.it/a#section",
            ],
            10,
        );
        assert_eq!(next, vec!["https://rossi-editore.it/a"]);
    }

    #[test]
    fn serialises_to_the_shape_the_renderer_reads() {
        // `ScanResult` in src/core/types.ts: hosts[].host, hosts[].requestCount,
        // pagesVisited. `scannedHost` is the caller's to add.
        //
        // `possibleGaps` was the one key here that `ScanResult` did not yet
        // have when this module was first written. Task 9 has since added it
        // to `ScanResult` and surfaced it, and Task 10's printed limits
        // statement mentions it when it is non-zero.
        //
        // The name is load-bearing. It says "places where the map may be
        // incomplete", which is all the number can honestly claim: a failed
        // `setAutoAttach` hides an unknowable number of child frames behind a
        // single entry. It was called `unobservedTargets` and that read as a
        // precise count of unobserved targets, which it is not.
        let observation = Observation {
            hosts: vec![ObservedHost {
                host: "doubleclick.net".to_string(),
                request_count: 3,
            }],
            pages_visited: 4,
            possible_gaps: 0,
            stopped_early: false,
        };
        assert_eq!(
            serde_json::to_value(&observation).expect("json"),
            json!({
                "hosts": [{"host": "doubleclick.net", "requestCount": 3}],
                "pagesVisited": 4,
                "possibleGaps": 0,
                "stoppedEarly": false
            })
        );
    }
}
