//! Observing which hosts a scanned site contacts, over the Chrome DevTools
//! Protocol.
//!
//! **This module observes. It does not enforce.** By the time a request
//! reaches CDP the proxy has already made the admission decision — during a
//! scan it admits any named host on 80/443, as a visitor's browser would reach
//! it, and refuses the rest (`admission.rs`, `proxy.rs`). What CDP
//! adds is *attribution*: which host, how many requests. Nothing here is a
//! guard, and nothing here should ever be read as one. The CDP spike measured
//! this view missing 15 of 37 hosts the proxy saw, which is why the proxy's
//! ledger and not this module is the source of truth for what was contacted.

use std::collections::{BTreeMap, HashSet, VecDeque};
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
use crate::consent::{self, Bridge, Consent, ConsentRule, EngineMsg};

/// Whether something was first seen before any consent was given, or after a
/// consent attempt began. The first phase wins: a tracker that fires before
/// the click and again after it stays `Before`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Before,
    After,
}

/// One host the scanned pages contacted, and how many requests went to it.
///
/// Serialises to `ScanResult["hosts"][n]` in `src/core/types.ts`: `host`,
/// `requestCount`, `phase`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedHost {
    pub host: String,
    pub request_count: u32,
    pub phase: Phase,
}

/// One cookie the browser held when the scan ended, capped and sanitised —
/// see [`sanitise_cookies`]. The cookie's own `value` is never extracted;
/// only these four fields ever leave the page.
///
/// Serialises to `ScanResult["cookies"][n]` in `src/core/types.ts`, field for
/// field with `RawScanCookie`: `name`, `domain`, `session`,
/// `expiresEpochSeconds`, `phase`. `phase` is omitted when it is not known —
/// see [`Driver::finish`]. `f64` rather than an integer because CDP hands back
/// `expires` as a float and core receives a JSON number either way.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCookie {
    pub name: String,
    pub domain: String,
    pub session: bool,
    pub expires_epoch_seconds: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<Phase>,
}

/// One form field found on one visited page — never its value, see
/// [`FORM_PROBE`].
///
/// Serialises to `ScanResult["formFields"][n]` in `src/core/types.ts`, field
/// for field with `RawFormField`: `page`, `name`, `type`, `autocomplete`,
/// `label`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormField {
    pub page: String,
    pub name: String,
    pub r#type: String,
    pub autocomplete: String,
    pub label: String,
    /// Index among `document.forms`, -1 when the field is in no form.
    pub form: i32,
    /// Hostname of the enclosing form's `action`, vetted; empty when there is
    /// none or it is not a plain hostname. Never a path or a query.
    pub action_host: String,
}

/// An iframe `src` on a visited page: the host and the first path segment
/// only, see [`IFRAME_PROBE`]. Serialises to `RawIframe` in `types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct IframeSeen {
    pub page: String,
    pub host: String,
    pub segment: String,
}

/// A link from the home page to another site, whose path or text says it is
/// for booking, a newsletter or an account. Never visited. Serialises to
/// `RawOffsiteLink` in `types.ts`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct OffsiteLink {
    pub page: String,
    pub host: String,
    pub purpose: Purpose,
}

/// One `localStorage`/`sessionStorage` entry found on a visited page — its
/// key name and the byte length of its value, never the value itself. See
/// [`STORAGE_PROBE`].
///
/// Serialises to `ScanResult["storageKeys"][n]` in `src/core/types.ts`, field
/// for field with `RawStorageKey`: `scope`, `key`, `bytes`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageKey {
    pub scope: String,
    pub key: String,
    pub bytes: u64,
}

/// The most cookies one scan will record. The browser is driving a page this
/// app does not trust, so this is a bound on attacker-chosen data, the same
/// reasoning as [`MAX_HOSTS`]. Reaching it is a gap, never a silent
/// truncation.
const MAX_COOKIES: usize = 512;
/// What [`FORM_PROBE`] stops at, per page.
const FIELDS_PER_PAGE: usize = 64;
/// The most form fields one whole scan will record: the per-page cap for
/// every page the scan may visit, so a shop with 64 fields on each page still
/// reports its later key pages. Hitting it is a gap, the designed behaviour.
const MAX_FORM_FIELDS: usize = FIELDS_PER_PAGE * crate::scan::MAX_PAGES as usize;
/// The longest any one captured form-field string may be after [`tame`] —
/// `name`, `type`, `autocomplete`, `label`. **Not** `page` — see
/// [`MAX_PAGE_URL`] — a real URL routinely exceeds 128 characters, and
/// truncating it here would merge two distinct long URLs into the one
/// collection point Task 9 groups by `page`. The same number is baked into
/// [`FORM_PROBE`] itself as the in-page `.slice(0, 128)` on every element
/// string before it ever becomes a WebSocket frame — see that constant's doc
/// comment for why capping the element count alone is not enough.
const MAX_FIELD_TEXT: usize = 128;
/// The longest [`page_identity`] will return, after [`tame`]. Aligned with
/// `scan::MAX_URL_LEN` (2048) — the bound already enforced on any URL this
/// module is ever handed, by `scan::parse_target` on the entry URL and by
/// [`same_origin_links`]'s own filtering on every link followed after it —
/// rather than with [`MAX_FIELD_TEXT`], which is sized for a short attribute
/// value, not a path. A page's own bound, not a shared one: two distinct long
/// URLs must not truncate to the same prefix and merge into one door.
const MAX_PAGE_URL: usize = 2048;
/// The longest a cookie `name` may be after [`tame`].
const MAX_COOKIE_NAME: usize = 256;
/// The longest a cookie `domain` may be after [`tame`] — one hostname, the
/// same bound as [`MAX_HOST_LEN`].
const MAX_COOKIE_DOMAIN: usize = 253;
/// The most storage keys one whole scan will record, across every page and
/// both `localStorage` and `sessionStorage`, after deduplication on
/// `(scope, key)`. Reaching it is a gap, the same designed behaviour as
/// [`MAX_FORM_FIELDS`].
const MAX_STORAGE_KEYS: usize = 256;
/// The longest a storage `key` may be after [`tame`] — the same number is
/// baked into [`STORAGE_PROBE`] itself as the in-page `.slice(0, 128)` on the
/// unsliced key before it ever becomes a WebSocket frame, for the same
/// reason as [`MAX_FIELD_TEXT`]: capping the entry count alone does not bound
/// the bytes a single unsliced `DOMString` could carry.
const MAX_KEY_LEN: usize = 128;

/// Bounds and cleans a string read off a hostile page: at most `max_chars`
/// **characters**, never bytes, and every Unicode `Cc` (control) or `Cf`
/// (format — this is where the bidi override characters live: U+200E/U+200F,
/// U+202A-U+202E, U+2066-U+2069) character replaced with `'?'` rather than
/// deleted.
///
/// Characters, not bytes, because `s.chars().take(max_chars).collect()`
/// cannot panic mid-codepoint on a hostile multibyte string the way a byte
/// slice could. Replaced rather than deleted so a name is never silently
/// rewritten into a *different valid* name — a cookie called
/// `sess\u{200E}ion` truncated by deletion reads as `session`, a real cookie
/// that never existed. Every other printable Unicode character — accented
/// Italian letters, emoji — passes through untouched: this is not an
/// ASCII-only filter, and must not be replaced with one (`redact_authority`
/// is ASCII-only and would mangle "città", "cognome").
///
/// Shared by every sanitiser in this module that reads a string out of the
/// page: cookies here, and later form fields and storage keys.
fn tame(raw: &str, max_chars: usize) -> String {
    use unicode_properties::{GeneralCategory, UnicodeGeneralCategory};
    raw.chars()
        .take(max_chars)
        .map(|c| match c.general_category() {
            GeneralCategory::Control | GeneralCategory::Format => '?',
            _ => c,
        })
        .collect()
}

/// Reads exactly four named keys from each raw cookie object handed back by
/// `Storage.getCookies` — `name`, `domain`, `session`, `expires` — and
/// nothing else. The cookie's own `value` is never read, never copied, never
/// logged; there is no `#[serde(flatten)]` and no deserialising into a struct
/// that carries it.
///
/// An entry of the wrong shape — including an `expires` that is not finite
/// (`NaN`/`+-inf`, which `serde_json::to_string` errors on and would
/// otherwise turn a completed scan into `SCAN_FAILED`) — is dropped and
/// counted rather than propagated. A finite `expires` is clamped to
/// `-1.0 ..= 4e9` before being retained. `name` and `domain` are run through
/// [`tame`] and bounded by [`MAX_COOKIE_NAME`]/[`MAX_COOKIE_DOMAIN`].
///
/// Returns the retained cookies, capped at [`MAX_COOKIES`], and whether
/// anything was dropped or capped — the caller folds that into
/// `possible_gaps`; hitting the cap must never read as a clean sheet.
fn sanitise_cookies(raw: &[serde_json::Value]) -> (Vec<ScanCookie>, bool) {
    let mut gap = false;
    let mut cookies = Vec::new();
    for value in raw {
        if cookies.len() >= MAX_COOKIES {
            gap = true;
            continue;
        }
        let name = value.get("name").and_then(|v| v.as_str());
        let domain = value.get("domain").and_then(|v| v.as_str());
        let session = value.get("session").and_then(|v| v.as_bool());
        let expires = value
            .get("expires")
            .and_then(|v| v.as_f64())
            .filter(|e| e.is_finite());
        let (Some(name), Some(domain), Some(session), Some(expires)) =
            (name, domain, session, expires)
        else {
            gap = true;
            continue;
        };
        cookies.push(ScanCookie {
            name: tame(name, MAX_COOKIE_NAME),
            domain: tame(domain, MAX_COOKIE_DOMAIN),
            session,
            expires_epoch_seconds: expires.clamp(-1.0, 4e9),
            // Provisional: [`Driver::finish`] sets the real phase.
            phase: None,
        });
    }
    (cookies, gap)
}

/// Reads the `name`, `type`, `autocomplete` and `label` keys [`FORM_PROBE`]
/// hands back for one page, and nothing else — in particular, never a
/// `value` (there is none in the probe's own shape) and never anything the
/// page itself might claim about its own URL, such as a `location` key
/// planted in `raw` [B4].
///
/// `page` is not read from `raw` at all: it is `page_url`, exactly as
/// [`Driver::run`]'s own walk already knows it, reduced by [`page_identity`]
/// to scheme + authority + path with the query and fragment stripped. An
/// entry of the wrong shape is dropped and counted rather than propagated,
/// the same rule as [`sanitise_cookies`]. `already` is how many fields this
/// scan has retained on earlier pages; the scan-wide [`MAX_FORM_FIELDS`] cap
/// is enforced against `already + fields.len()`, so a page-by-page walk stays
/// bounded across the whole scan and not just within one page's probe.
fn sanitise_form_fields(
    page_url: &str,
    raw: &serde_json::Value,
    already: usize,
) -> (Vec<FormField>, bool) {
    let mut gap = false;
    let mut fields = Vec::new();
    let page = page_identity(page_url);
    let Some(array) = raw.as_array() else {
        return (fields, true);
    };
    for item in array {
        if already + fields.len() >= MAX_FORM_FIELDS {
            gap = true;
            continue;
        }
        let name = item.get("name").and_then(|v| v.as_str());
        let field_type = item.get("type").and_then(|v| v.as_str());
        let autocomplete = item.get("autocomplete").and_then(|v| v.as_str());
        let label = item.get("label").and_then(|v| v.as_str());
        let (Some(name), Some(field_type), Some(autocomplete), Some(label)) =
            (name, field_type, autocomplete, label)
        else {
            gap = true;
            continue;
        };
        let form = item
            .get("form")
            .and_then(|v| v.as_i64())
            .filter(|n| (-1..MAX_FORM_INDEX).contains(n))
            .unwrap_or(-1) as i32;
        let action_host = item
            .get("action")
            .and_then(|v| v.as_str())
            .map(action_host)
            .unwrap_or_default();
        fields.push(FormField {
            page: page.clone(),
            name: tame(name, MAX_FIELD_TEXT),
            r#type: tame(field_type, MAX_FIELD_TEXT),
            autocomplete: tame(autocomplete, MAX_FIELD_TEXT),
            label: tame(label, MAX_FIELD_TEXT),
            form,
            action_host,
        });
    }
    (fields, gap)
}

/// No page has this many forms worth telling apart; a larger index is the
/// page lying and reads as "no form".
const MAX_FORM_INDEX: i64 = 4096;
/// Iframes kept per page; [`IFRAME_PROBE`] reads one more to prove the cap.
const IFRAMES_PER_PAGE: usize = 32;
/// Off-site links kept for the whole scan (they come from the home page).
const MAX_OFFSITE_LINKS: usize = 32;

/// A form action's hostname, or empty: `vet_host`'s shape, never an IP
/// literal. What the page sends is a hostname already; this is the second
/// filter, so a `javascript:` action or a stray path reads as nothing.
fn action_host(raw: &str) -> String {
    match crate::admission::vet_host(raw) {
        Some(h) if h.parse::<std::net::IpAddr>().is_err() => h.to_ascii_lowercase(),
        _ => String::new(),
    }
}

/// Reads the `[host, segment]` pairs [`IFRAME_PROBE`] hands back: at most
/// [`IFRAMES_PER_PAGE`], the host through [`action_host`]'s filter, the
/// segment only when it is `[a-z0-9-_]{0,32}` (else blank — the host is still
/// real). A bad entry is dropped; dropping or capping reports a gap.
fn sanitise_iframes(page_url: &str, raw: &serde_json::Value) -> (Vec<IframeSeen>, bool) {
    let page = page_identity(page_url);
    let Some(array) = raw.as_array() else {
        return (Vec::new(), true);
    };
    let mut gap = array.len() > IFRAMES_PER_PAGE;
    let mut frames = Vec::new();
    for item in array.iter().take(IFRAMES_PER_PAGE) {
        let pair = item.as_array().filter(|a| a.len() == 2);
        let host = pair.and_then(|a| a[0].as_str()).map(action_host).filter(|h| !h.is_empty());
        let (Some(pair), Some(host)) = (pair, host) else {
            gap = true;
            continue;
        };
        let segment = pair[1]
            .as_str()
            .filter(|s| {
                s.len() <= 32 && s.bytes().all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_'))
            })
            .unwrap_or("");
        frames.push(IframeSeen { page: page.clone(), host, segment: segment.to_string() });
    }
    (frames, gap)
}

/// Reads the `scope`, `key` and `bytes` keys [`STORAGE_PROBE`] hands back,
/// and nothing else — in particular never a value: `bytes` is the length the
/// probe computed *inside the page*, and the value string itself is never
/// part of the probe's own return shape.
///
/// An entry of the wrong shape, a `scope` outside `{local, session}`, or a
/// `bytes` that is not a non-negative integer is dropped and counted rather
/// than propagated, the same rule as [`sanitise_form_fields`]. `key` is run
/// through [`tame`] and bounded by [`MAX_KEY_LEN`] — defensively, since
/// [`STORAGE_PROBE`] already slices it in the page.
///
/// `existing` is every storage key this scan has already retained, on
/// earlier pages; deduplication is on `(scope, key)`, first-seen wins, so a
/// key already retained is silently skipped rather than counted twice or
/// treated as a gap — that is normal behaviour, not a defect. The scan-wide
/// [`MAX_STORAGE_KEYS`] cap is enforced against `existing.len()` plus what
/// this call retains, so a page-by-page walk stays bounded across the whole
/// scan and not just within one page's probe, mirroring
/// [`sanitise_form_fields`]'s `already` parameter.
fn sanitise_storage_keys(
    raw: &serde_json::Value,
    existing: &[StorageKey],
) -> (Vec<StorageKey>, bool) {
    let mut gap = false;
    let mut keys = Vec::new();
    let Some(array) = raw.as_array() else {
        return (keys, true);
    };
    for item in array {
        let scope = item.get("scope").and_then(|v| v.as_str());
        let key = item.get("key").and_then(|v| v.as_str());
        let bytes = item.get("bytes").and_then(|v| v.as_u64());
        let (Some(scope), Some(key), Some(bytes)) = (scope, key, bytes) else {
            gap = true;
            continue;
        };
        if scope != "local" && scope != "session" {
            gap = true;
            continue;
        }
        let key = tame(key, MAX_KEY_LEN);
        // Dedupe before the cap check: a later-page repeat of a key this scan
        // already retained is not a new entry, so it must not be charged
        // against MAX_STORAGE_KEYS — only a genuinely new key can trip the
        // cap. Checking the cap first would record a gap at exactly the cap
        // for a duplicate that cost nothing, which is not the honest claim
        // `possible_gaps` makes.
        if existing.iter().chain(keys.iter()).any(|k| k.scope == scope && k.key == key) {
            continue;
        }
        if existing.len() + keys.len() >= MAX_STORAGE_KEYS {
            gap = true;
            continue;
        }
        keys.push(StorageKey {
            scope: scope.to_string(),
            key,
            // The byte length as first observed: if this key's value grows or
            // shrinks later in the walk, dedupe (first-seen wins) means this
            // scan keeps reporting the size it saw the first time, never the
            // current one.
            bytes,
        });
    }
    (keys, gap)
}

/// The visited URL reduced to what identifies the page in a form-field
/// report: scheme + authority + path, with the query and fragment stripped
/// and the result run through [`tame`] and bounded by [`MAX_PAGE_URL`] — not
/// [`MAX_FIELD_TEXT`], which is too short for a real path and would merge two
/// distinct long URLs into the one collection point Task 9 groups by `page`.
///
/// This is *the walk's own knowledge* of what it navigated to [B4] — the
/// argument is always the URL [`Driver::run`] itself passed to
/// [`Driver::visit`], never anything read off the page (`location.href` is
/// page-controlled and must never stand in for it: a hostile page could
/// rewrite `history.replaceState` to attribute its fields to a different
/// page entirely).
fn page_identity(url: &str) -> String {
    let without_fragment = url.split('#').next().unwrap_or("");
    let without_query = without_fragment.split('?').next().unwrap_or("");
    tame(without_query, MAX_PAGE_URL)
}

/// What one scan saw.
///
/// Serialises to
/// `{ "hosts": [...], "pagesVisited": n, "possibleGaps": n, "stoppedEarly": bool }`.
/// `ScanResult`'s remaining field, `scannedHost`, is the caller's — Task 8
/// knows the URL the user typed and this module deliberately does not decide
/// what "the scanned host" is.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
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
    /// The browser's cookie jar at the moment the scan ended, capped and
    /// sanitised. Populated once, by `observe()`, after the page walk
    /// completes — never by [`Driver::observation`] itself, which stays a
    /// pure fold over what the driver already collected and is exercised
    /// directly by most of this module's own tests without a transport that
    /// answers `Storage.getCookies` at all.
    pub cookies: Vec<ScanCookie>,
    /// The CMP autoconsent's rules detected on the entry page, and whether
    /// its rule accepted — see [`Driver::detect_consent`] and
    /// [`Driver::consent_step`]. Default (no reason) when detection never ran.
    pub consent: Consent,
    /// Form fields found across every visited page, capped scan-wide at
    /// [`MAX_FORM_FIELDS`] — never a value, only the field's own shape. A
    /// page whose navigation was refused (`Driver::visit` returned `false`)
    /// contributes nothing here: it was never loaded under its own identity,
    /// so nothing on it was ever this walk's to attribute.
    pub form_fields: Vec<FormField>,
    /// `localStorage`/`sessionStorage` key names and value sizes found across
    /// every visited page, deduplicated on `(scope, key)` first-seen wins and
    /// capped scan-wide at [`MAX_STORAGE_KEYS`] — never a value, only the
    /// key's own name and size. A page whose navigation was refused
    /// (`Driver::visit` returned `false`) contributes nothing here, the same
    /// rule as [`Self::form_fields`].
    pub storage_keys: Vec<StorageKey>,
    /// The key pages that were loaded (not the home page), with the purpose
    /// their link was picked for. An off-site redirect is not here.
    pub pages: Vec<VisitedPage>,
    /// Iframe hosts and first path segments on every probed page, at most 32
    /// per page.
    pub iframes: Vec<IframeSeen>,
    /// Booking/newsletter/account links from the home page to other sites.
    pub offsite_links: Vec<OffsiteLink>,
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

/// A fixed expression, evaluated once per visited page: reads `name`, `type`,
/// `autocomplete` and a best-effort `label` off every `input`/`select`/
/// `textarea` element — never `value` (spec §5.3, "Never values — nothing is
/// ever typed"). Nothing from the page is interpolated into this string; it
/// is a `const`, sent byte for byte, the same discipline as every probe here.
///
/// **[B1]** Every string is sliced *inside the page*, at [`MAX_FIELD_TEXT`] —
/// the same number [`sanitise_form_fields`] uses on the Rust side — before
/// any of it becomes a WebSocket frame: chromiumoxide's `Connection` is built
/// with `max_message_size: None, max_frame_size: None` (`conn.rs:43-46`), so
/// capping the element count at 64 alone would not bound the bytes a single
/// unsliced DOMString could carry.
///
/// `label` is coerced with `String(...)` before `.slice()` runs, even though
/// it is only ever assigned a string (`|| ''`) inside its own `try`: a page
/// that poisons `Node.prototype.textContent`'s getter to return an object
/// instead of a string would otherwise throw on the bare `.slice()` call,
/// which sits outside that `try` — and that throw would zero every field on
/// the whole page, not just the poisoned one.
const FORM_PROBE: &str = r#"(() => {
  const out = [];
  const els = document.querySelectorAll('input, select, textarea');
  for (let i = 0; i < els.length && out.length < 64; i++) {
    const el = els[i];
    let label = '';
    try { if (el.labels && el.labels[0]) label = el.labels[0].textContent || ''; } catch (e) {}
    out.push({ name: String(el.name || el.id || '').slice(0, 128), type: String(el.type || el.tagName || '').toLowerCase().slice(0, 128),
               autocomplete: String(el.getAttribute('autocomplete') || '').slice(0, 128), label: String(label).slice(0, 128),
               form: el.form ? [...document.forms].indexOf(el.form) : -1,
               action: el.form ? (() => { try { return new URL(el.form.action, location.href).hostname.slice(0, 253) } catch (e) { return '' } })() : '' });
  }
  return out;
})()"#;

/// A fixed expression, evaluated once per visited on-site page after
/// [`FORM_PROBE`]: the host and first path segment of each `iframe[src]`,
/// capped in the page at 33 so the 33rd proves [`IFRAMES_PER_PAGE`] was hit.
/// Nothing from the page is interpolated into it.
const IFRAME_PROBE: &str = r#"[...document.querySelectorAll('iframe[src]')].slice(0, 33).map(f => { try { const u = new URL(f.src, location.href); return [u.hostname.slice(0, 253), (u.pathname.split('/')[1] || '').slice(0, 32).toLowerCase()] } catch (e) { return null } }).filter(Boolean)"#;

/// A fixed expression, evaluated once per visited page: reads the key names
/// and value sizes of `window.localStorage` and `window.sessionStorage` —
/// never a value itself (spec §5.3, "Never values"). Nothing from the page
/// is interpolated into this string; it is a `const`, sent byte for byte,
/// the same discipline as [`FORM_PROBE`].
///
/// **[B1]** The key is sliced *inside the page*, at [`MAX_KEY_LEN`] (128) —
/// the same number [`sanitise_storage_keys`] uses on the Rust side — before
/// it ever becomes a WebSocket frame, the same reasoning as [`FORM_PROBE`]'s
/// own doc comment: `store.key(i)` is a page-controlled `DOMString` of
/// arbitrary length, and capping the entry count at 128 alone would not
/// bound the bytes a single unsliced key could carry.
///
/// The byte length is read from the **unsliced** key, before the key is
/// truncated for return: `getItem` is only ever called with the full key, so
/// a key longer than [`MAX_KEY_LEN`] still reports its value's true length
/// rather than a spurious zero from `getItem` on a truncated name that no
/// longer exists in the store.
const STORAGE_PROBE: &str = r#"(() => {
  const out = [];
  const read = (store, scope) => {
    try {
      for (let i = 0; i < store.length && out.length < 128; i++) {
        const full = String(store.key(i));
        out.push({ scope, key: full.slice(0, 128), bytes: (store.getItem(full) || '').length });
      }
    } catch (e) {}
  };
  read(window.localStorage, 'local');
  read(window.sessionStorage, 'session');
  return out;
})()"#;

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
#[derive(Debug, Default, Clone)]
pub struct HostAccumulator {
    counts: BTreeMap<String, (u32, Phase)>,
    overflowed: bool,
}

impl HostAccumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records one request. A URL with no host of interest — `data:`,
    /// `about:`, `blob:`, a relative path, anything unparseable — is dropped
    /// rather than counted under some invented name.
    /// `phase` is kept only the first time a host is seen.
    pub fn record(&mut self, url: &str, phase: Phase) {
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
        let (count, _) = self.counts.entry(host).or_insert((0, phase));
        *count = count.saturating_add(1);
    }

    /// Every host recorded so far.
    fn known(&self) -> HashSet<String> {
        self.counts.keys().cloned().collect()
    }

    /// Every host not in `known` goes back to [`Phase::Before`].
    fn rewind_to_before(&mut self, known: &HashSet<String>) {
        for (host, (_, phase)) in self.counts.iter_mut() {
            if !known.contains(host) {
                *phase = Phase::Before;
            }
        }
    }

    /// True once a request was refused for want of room. The map is then known
    /// to be incomplete and must say so.
    pub fn overflowed(&self) -> bool {
        self.overflowed
    }

    pub fn finish(self) -> Vec<ObservedHost> {
        self.counts
            .into_iter()
            .map(|(host, (request_count, phase))| ObservedHost {
                host,
                request_count,
                phase,
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

/// What a key page is for. Spec §6.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    Contacts,
    Careers,
    Shop,
    Booking,
    Newsletter,
    Account,
}

/// Spec §6, verbatim. A keyword with a `-` is a sequence of whole words.
const PURPOSES: [(Purpose, &[&str]); 6] = [
    (
        Purpose::Contacts,
        &["contatti", "contatto", "contattaci", "contact", "contacts", "dove-siamo"],
    ),
    (
        Purpose::Careers,
        &["lavora-con-noi", "carriere", "careers", "jobs", "candidature", "posizioni-aperte"],
    ),
    (
        Purpose::Shop,
        &["shop", "negozio", "store", "carrello", "cart", "checkout", "prodotti"],
    ),
    (
        Purpose::Booking,
        &[
            "prenota",
            "prenotazione",
            "prenotazioni",
            "booking",
            "book",
            "appuntamento",
            "reservation",
        ],
    ),
    (Purpose::Newsletter, &["newsletter", "iscriviti", "subscribe"]),
    (
        Purpose::Account,
        &["login", "accedi", "registrati", "area-riservata", "account"],
    ),
];

/// Extensions of files that are not pages.
const SKIPPED_EXTENSIONS: [&str; 13] = [
    "pdf", "doc", "docx", "xls", "xlsx", "zip", "jpg", "jpeg", "png", "gif", "webp", "svg", "mp4",
];

/// Lowercase words: everything that is not `[a-z0-9àèéìòù]` separates, so
/// `facebook` is one word and `lavora-con-noi` is three.
fn words(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !(c.is_ascii_alphanumeric() || "àèéìòù".contains(c)))
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// True when `keyword`'s words appear contiguously, in order, in `words`.
fn has_keyword(words: &[String], keyword: &str) -> bool {
    let kw: Vec<&str> = keyword.split('-').collect();
    words
        .windows(kw.len())
        .any(|w| w.iter().zip(&kw).all(|(a, b)| a == b))
}

/// The purpose a link serves and how strongly: 2 for a keyword in the path
/// plus 1 for one in the anchor text. The strongest purpose wins; a tie goes
/// to the earlier row of [`PURPOSES`]. `None` when nothing matches.
pub fn purpose_of(path: &str, text: &str) -> Option<(Purpose, u8)> {
    let (path, text) = (words(path), words(text));
    let mut best: Option<(Purpose, u8)> = None;
    for (purpose, keywords) in PURPOSES {
        let score = 2 * keywords.iter().any(|k| has_keyword(&path, k)) as u8
            + keywords.iter().any(|k| has_keyword(&text, k)) as u8;
        if score > best.map_or(0, |b| b.1) {
            best = Some((purpose, score));
        }
    }
    best
}

/// The path and the query of an absolute `http(s)` URL.
fn path_and_query(url: &str) -> (&str, &str) {
    let rest = url.split_once("//").map_or("", |(_, r)| r);
    let rest = rest.find(['/', '?']).map_or("", |i| &rest[i..]);
    rest.split_once('?').unwrap_or((rest, ""))
}

/// The pages worth loading next, `(url, purpose)`: same scheme and host as
/// `entry_url` (compared exactly: `www.` is another host), absolute, not the
/// entry page, no files and no print views, deduplicated.
///
/// Order: the best-scoring link per purpose (table order), then every other
/// link with a purpose by score, then the rest in document order; truncated
/// to `limit`.
pub fn pick_pages(
    entry_url: &str,
    links: &[(&str, &str)],
    limit: usize,
) -> Vec<(String, Option<Purpose>)> {
    let Some(entry_origin) = origin(entry_url) else {
        return Vec::new();
    };
    let entry_key = canonical(entry_url);
    // (url, purpose, score) in document order.
    let mut found: Vec<(String, Option<Purpose>, u8)> = Vec::new();
    for (link, text) in links {
        let link = link.split('#').next().unwrap_or("");
        if link.is_empty() || origin(link).as_ref() != Some(&entry_origin) {
            continue;
        }
        // A backslash is read as a slash by some parsers and not by others;
        // userinfo would carry credentials into the recorded page identity.
        let authority = link.split_once("//").map_or("", |(_, r)| r.split(['/', '?']).next().unwrap_or(""));
        if link.contains('\\') || authority.contains('@') {
            continue;
        }
        let (path, query) = path_and_query(link);
        let extension = path.rsplit('/').next().and_then(|f| f.rsplit_once('.')).map(|e| e.1);
        if extension.is_some_and(|e| SKIPPED_EXTENSIONS.contains(&e.to_lowercase().as_str()))
            || words(&format!("{path} {query}")).iter().any(|w| w == "print")
        {
            continue;
        }
        let key = canonical(link);
        if key == entry_key || found.iter().any(|(seen, ..)| canonical(seen) == key) {
            continue;
        }
        let (purpose, score) = purpose_of(path, text).map_or((None, 0), |(p, s)| (Some(p), s));
        found.push((link.to_string(), purpose, score));
    }
    let mut taken = vec![false; found.len()];
    let mut out: Vec<usize> = Vec::new();
    for (purpose, _) in PURPOSES {
        let best = found
            .iter()
            .enumerate()
            .filter(|(_, f)| f.1 == Some(purpose))
            .max_by_key(|(i, f)| (f.2, std::cmp::Reverse(*i)))
            .map(|(i, _)| i);
        if let Some(i) = best {
            taken[i] = true;
            out.push(i);
        }
    }
    let mut more: Vec<usize> = (0..found.len()).filter(|&i| !taken[i] && found[i].1.is_some()).collect();
    more.sort_by_key(|&i| (std::cmp::Reverse(found[i].2), i));
    out.extend(more);
    out.extend((0..found.len()).filter(|&i| found[i].1.is_none()));
    out.into_iter()
        .take(limit)
        .map(|i| (found[i].0.clone(), found[i].1))
        .collect()
}

/// Links to *other* sites whose path or text says booking, newsletter or
/// account, from the entry page's `(href, text)` list: never visited, one per
/// `(host, purpose)`, at most [`MAX_OFFSITE_LINKS`] (the bool is the gap when
/// more existed). The host must be a plain vetted name that is neither the
/// entry's own host nor a subdomain of it; credentials and backslashes in the
/// URL are refused as in [`pick_pages`].
fn offsite_links(entry_url: &str, links: &[(&str, &str)]) -> (Vec<OffsiteLink>, bool) {
    let Some(own) = http_host(entry_url) else {
        return (Vec::new(), false);
    };
    let page = page_identity(entry_url);
    let mut found: Vec<OffsiteLink> = Vec::new();
    let mut gap = false;
    for (link, text) in links {
        let link = link.split('#').next().unwrap_or("");
        let authority = link.split_once("//").map_or("", |(_, r)| r.split(['/', '?']).next().unwrap_or(""));
        if link.contains('\\') || authority.contains('@') {
            continue;
        }
        let Some(host) = http_host(link).map(|h| action_host(&h)).filter(|h| !h.is_empty()) else {
            continue;
        };
        if host == own || host.ends_with(&format!(".{own}")) {
            continue;
        }
        let (path, _) = path_and_query(link);
        let Some((purpose @ (Purpose::Booking | Purpose::Newsletter | Purpose::Account), _)) =
            purpose_of(path, text)
        else {
            continue;
        };
        if found.iter().any(|o| o.host == host && o.purpose == purpose) {
            continue;
        }
        if found.len() >= MAX_OFFSITE_LINKS {
            gap = true;
            continue;
        }
        found.push(OffsiteLink { page: page.clone(), host, purpose });
    }
    (found, gap)
}

/// A page the walk visited, and what it is for when its link said so.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct VisitedPage {
    pub page: String,
    pub purpose: Option<Purpose>,
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
/// The entry page's quiet period instead: long enough for a consent manager
/// and the trackers it lets through unasked to show up before any click.
const HOME_WAIT: Duration = Duration::from_secs(8);
/// How long a single read may block before cancellation is re-checked.
const CANCEL_POLL: Duration = Duration::from_millis(100);
/// Cap on the number of `href`s taken out of a page before filtering, so a
/// hostile page cannot return a hundred megabytes of strings.
const MAX_LINKS_READ: usize = 500;
/// Cap on the length of a single `href`, applied inside the page. Well past
/// any real URL and past IE's old 2,083-character limit; the point is that
/// `MAX_LINKS_READ` bounds the count and this bounds the bytes.
const MAX_LINK_LEN: usize = 4096;
/// The longest anchor text kept, in [`LINKS_PROBE`] and again in Rust.
const MAX_LINK_TEXT: usize = 64;
/// Read once per scan, on the home page. Fixed: nothing in it is built from
/// anything the page said. Its three numbers are [`MAX_LINKS_READ`],
/// [`MAX_LINK_LEN`] and [`MAX_LINK_TEXT`]; a test keeps them equal.
const LINKS_PROBE: &str = "JSON.stringify([...document.querySelectorAll('a[href]')].slice(0, 500).map(a => [String(a.href).slice(0, 4096), String(a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 64)]))";

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

/// [`auto_attach_params`] for a child session, minus service workers.
///
/// A service worker is a browser-level target the browser session already
/// attaches. Attached a second time here, it stays paused until *both* sessions
/// resume it, and the one-in-flight driver deadlocks on `Network.enable` until
/// the 30 s timeout fails the scan (docs/decisions/2026-09-29-scanner-failures.md).
fn session_auto_attach_params() -> Result<serde_json::Value, CdpError> {
    use chromiumoxide::cdp::browser_protocol::target::{FilterEntry, TargetFilter};

    let mut params = SetAutoAttachParams::new(true, true);
    params.flatten = Some(true);
    params.filter = Some(TargetFilter::new(vec![
        FilterEntry {
            exclude: Some(true),
            r#type: Some("service_worker".to_string()),
        },
        // An empty entry matches every other type; without it the filter matches nothing.
        FilterEntry {
            exclude: None,
            r#type: None,
        },
    ]));
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
///    counted the same way. Service workers are excluded here: the browser
///    session attaches them, and a second attach deadlocks arming
///    ([`session_auto_attach_params`]).
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
            session_auto_attach_params()?,
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
/// How long the engine gets to detect a CMP and its popup on the entry page.
/// A page with no CMP spends all of it: the engine reports "nothing found"
/// only in a `report`, which the bridge does not read.
const DETECT_BUDGET: Duration = Duration::from_secs(12);
/// How long the engine gets to answer Rust's `optIn` with its `optInResult`.
const OPT_IN_BUDGET: Duration = Duration::from_secs(10);
/// Parsed engine messages held between reads. The engine sends a handful per
/// scan; the bound is for an engine a crafted DOM keeps busy.
const MAX_CONSENT_INBOX: usize = 256;

/// The scan's consent result from a detection. "no-banner" only when the
/// engine ran (`context`) and the detection was not cut short by a cancel:
/// a bridge that failed or never finished is a blank, not "no banner".
fn consent_found(detection: Detection, cancelled: bool) -> Consent {
    let reason = match (&detection.cmp, detection.context) {
        (Some(_), _) => Some("no-button"),
        (None, Some(_)) if !cancelled => Some("no-banner"),
        _ => None,
    };
    Consent {
        cmp: detection.cmp,
        reason,
        ..Consent::default()
    }
}

/// What [`Driver::detect_consent`] found. `context` is `None` when the
/// bridge failed.
#[derive(Debug, Default)]
struct Detection {
    cmp: Option<String>,
    popup: bool,
    context: Option<i64>,
    /// The engine's answer to Rust's own `optIn`, checked by [`Bridge`].
    clicked: bool,
}

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
    /// Set once, from [`Driver::detect_consent`], on the entry page.
    consent: Consent,
    /// The isolated world's execution context: the only one whose
    /// `Runtime.bindingCalled` is read.
    consent_context: Option<i64>,
    /// Engine messages already parsed, bounded at [`MAX_CONSENT_INBOX`].
    consent_inbox: VecDeque<EngineMsg>,
    /// Whether Rust's own `optIn` is waiting for its answer.
    consent_bridge: Bridge,
    /// Form fields accumulated across every page [`Driver::visit`] actually
    /// loaded, via [`Driver::probe_form_fields`] — see
    /// [`Observation::form_fields`].
    form_fields: Vec<FormField>,
    /// Storage keys accumulated across every page [`Driver::visit`] actually
    /// loaded, via [`Driver::probe_storage_keys`] — see
    /// [`Observation::storage_keys`].
    storage_keys: Vec<StorageKey>,
    /// The phase every host and cookie seen from now on is tagged with.
    phase: Phase,
    /// The hosts already known when a consent attempt began, so a failed
    /// attempt can give back everything first seen during it.
    attempt_known: Option<HashSet<String>>,
    /// `(name, domain)` of every cookie at the first snapshot, taken on the
    /// home page before any click. `None` when that snapshot never ran, failed,
    /// or came back with a gap: then which cookies came first is not known.
    before_cookies: Option<HashSet<(String, String)>>,
    /// Key pages loaded on the entry's own origin, see [`Observation::pages`].
    pages: Vec<VisitedPage>,
    iframes: Vec<IframeSeen>,
    offsite_links: Vec<OffsiteLink>,
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
            consent: Consent::default(),
            consent_context: None,
            consent_inbox: VecDeque::new(),
            consent_bridge: Bridge::default(),
            form_fields: Vec::new(),
            storage_keys: Vec::new(),
            phase: Phase::Before,
            attempt_known: None,
            before_cookies: None,
            pages: Vec::new(),
            iframes: Vec::new(),
            offsite_links: Vec::new(),
        }
    }

    /// A consent click is about to happen: everything first seen from now on
    /// is `After`. A second call while one attempt is open keeps the first
    /// attempt's hosts, so an abandon gives back everything since the first.
    fn begin_consent_attempt(&mut self) {
        if self.attempt_known.is_none() {
            self.attempt_known = Some(self.acc.known());
        }
        self.phase = Phase::After;
    }

    /// The attempt failed, so no consent was given: everything first seen
    /// since it began goes back to `Before`.
    fn abandon_consent_attempt(&mut self) {
        if let Some(known) = self.attempt_known.take() {
            self.acc.rewind_to_before(&known);
        }
        self.phase = Phase::Before;
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
                self.acc.record(url, self.phase);
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
        } else if method == "Runtime.bindingCalled" {
            // Only our binding, only from the isolated world detect_consent
            // created. Parsed here so the engine's frequent `report`s never
            // take a place in the bounded inbox.
            let p = &event.params;
            let ours = self.consent_context.is_some()
                && p.get("name").and_then(|n| n.as_str()) == Some(consent::BINDING)
                && p.get("executionContextId").and_then(|c| c.as_i64()) == self.consent_context;
            if ours && self.consent_inbox.len() < MAX_CONSENT_INBOX {
                if let Some(msg) = p
                    .get("payload")
                    .and_then(|m| m.as_str())
                    .and_then(consent::parse_engine_msg)
                {
                    self.consent_inbox.push_back(msg);
                }
            }
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
        settle: Duration,
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
            settle,
            cancel,
            Instant::now() + ARM_DRAIN_BUDGET,
        )
        .await?;
        Ok(true)
    }

    /// `(href, text)` of the page's own anchors, `href` already resolved to
    /// an absolute URL by the DOM, `text` the anchor's whitespace-collapsed
    /// text.
    async fn links(&mut self, session: &SessionId) -> Result<Vec<(String, String)>, CdpError> {
        // The caps run **in the page**, before any of this becomes a
        // WebSocket frame. They have to: chromiumoxide's `Connection` is built
        // with `max_message_size: None, max_frame_size: None` (conn.rs:43-46),
        // so 500 anchors carrying a megabyte of `href` each would be one
        // ~500 MB frame buffered whole and then re-allocated again by
        // `serde_json`. Capping the count alone does not bound the bytes.
        let mut params = EvaluateParams::new(LINKS_PROBE.to_string());
        // [B2] The call contract every probe (`Runtime.evaluate`) follows:
        // read the value back rather than a remote object handle, never pause
        // the page on an uncaught throw, never wait on a promise this probe
        // did not ask the page to make, and never let a poisoned prototype
        // getter or a `Storage` subclass whose `length` hangs run past its own
        // budget and take the whole scan down with it.
        params.return_by_value = Some(true);
        params.silent = Some(true);
        params.await_promise = Some(false);
        params.timeout = Some(chromiumoxide::cdp::js_protocol::runtime::TimeDelta::new(
            2000.0,
        ));
        let result = match self
            .call(
                Some(session.clone()),
                MethodId::from(EvaluateParams::IDENTIFIER),
                to_params(&params)?,
            )
            .await
        {
            Ok(result) => result,
            Err(CdpError::BrowserGone) => return Err(CdpError::BrowserGone),
            // [B2] Any other error from a probe call is a gap, not a scan
            // failure — including the timeout above firing.
            Err(_) => {
                self.gaps.note("links:probe-failed");
                return Ok(Vec::new());
            }
        };
        if result.get("exceptionDetails").is_some() {
            // [B2] The probe produced nothing: a hostile page that makes the
            // querying call throw a fabricated value must not have that value
            // read as the probe's answer.
            self.gaps.note("links:probe-exception");
            return Ok(Vec::new());
        }
        let Some(json) = result
            .get("result")
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_str())
        else {
            return Ok(Vec::new());
        };
        // Capped again here: the page is not trusted to have run its own
        // caps. An href at the in-page cap was cut off, so it is not a URL.
        let links = serde_json::from_str::<Vec<(String, String)>>(json).unwrap_or_default();
        Ok(links
            .into_iter()
            .filter(|(href, _)| href.chars().count() < MAX_LINK_LEN)
            .take(MAX_LINKS_READ)
            .map(|(href, text)| (href, tame(&text, MAX_LINK_TEXT)))
            .collect())
    }

    /// Evaluates `expression` on `session` under the fixed [B2] contract —
    /// `return_by_value`, `silent`, `await_promise: false`, 2000 ms — in the
    /// isolated world `context`, or in the page's main world when `None`.
    /// `None` back for anything but an answer: a refused or timed-out call, or
    /// `exceptionDetails`. `BrowserGone` still fails the scan.
    async fn bridge_eval(
        &mut self,
        session: &SessionId,
        expression: String,
        context: Option<i64>,
    ) -> Result<Option<serde_json::Value>, CdpError> {
        let mut params = EvaluateParams::new(expression);
        params.return_by_value = Some(true);
        params.silent = Some(true);
        params.await_promise = Some(false);
        params.timeout = Some(chromiumoxide::cdp::js_protocol::runtime::TimeDelta::new(
            2000.0,
        ));
        let mut params = to_params(&params)?;
        if let Some(context) = context {
            params["contextId"] = serde_json::json!(context);
        }
        match self
            .call(
                Some(session.clone()),
                MethodId::from(EvaluateParams::IDENTIFIER),
                params,
            )
            .await
        {
            Ok(result) if result.get("exceptionDetails").is_none() => Ok(Some(result)),
            Ok(_) => Ok(None),
            Err(CdpError::BrowserGone) => Err(CdpError::BrowserGone),
            Err(_) => Ok(None),
        }
    }

    /// Runs the vendored autoconsent engine, unmodified, in an isolated world
    /// on the entry page and reports which CMP its rules detected (spec §5.2).
    ///
    /// The binding exists only in worlds named [`consent::WORLD`], so the page
    /// cannot call it, and [`Driver::on_event`] only queues a call from the
    /// context recorded here. The engine's `eval` requests are the one
    /// expression not built from Rust consts: they run in the page's main
    /// world under the fixed contract, wrapped by [`consent::eval_request`]
    /// so only a boolean comes back.
    ///
    /// Any step failing is one gap, `consent:bridge`, and no detection — never
    /// a scan failure, except `BrowserGone`.
    async fn detect_consent(
        &mut self,
        session: &SessionId,
        cancel: &CancellationToken,
    ) -> Result<Detection, CdpError> {
        match self.start_engine(session).await {
            Ok(Some(_)) => {}
            Err(CdpError::BrowserGone) => return Err(CdpError::BrowserGone),
            Ok(None) | Err(_) => {
                self.consent_context = None;
                self.gaps.note("consent:bridge");
                return Ok(Detection::default());
            }
        }
        let detection = Detection {
            context: self.consent_context,
            ..Detection::default()
        };
        self.relay(session, cancel, Instant::now() + DETECT_BUDGET, detection)
            .await
    }

    /// Step 6 of [`Driver::detect_consent`], and the wait in
    /// [`Driver::consent_step`]: answers the engine's messages until
    /// `deadline`, cancel, a popup, the answer to Rust's `optIn`, or the
    /// engine's end. The deadline
    /// and cancel are checked before every message, because each `Eval` can
    /// cost two 2 s evaluations and the inbox refills while they run.
    async fn relay(
        &mut self,
        session: &SessionId,
        cancel: &CancellationToken,
        deadline: Instant,
        mut detection: Detection,
    ) -> Result<Detection, CdpError> {
        loop {
            while let Some(msg) = self.consent_inbox.pop_front() {
                if cancel.is_cancelled() || Instant::now() >= deadline {
                    return Ok(detection);
                }
                match msg {
                    EngineMsg::Init => {
                        if !self.consent_reply(session, consent::init_reply()).await? {
                            return Ok(Detection::default());
                        }
                    }
                    EngineMsg::Eval { id, code } => {
                        let answer =
                            self.bridge_eval(session, consent::eval_request(&code), None).await?;
                        let b = answer
                            .and_then(|r| r.get("result")?.get("value")?.as_bool())
                            .unwrap_or(false);
                        if !self.consent_reply(session, consent::eval_reply(&id, b)).await? {
                            return Ok(Detection::default());
                        }
                    }
                    EngineMsg::CmpDetected(name) => detection.cmp = consent::known_cmp(&name),
                    // The CMP whose popup was found is the one clicked. Once
                    // found, a repeat changes nothing.
                    EngineMsg::PopupFound(name) if !detection.popup => {
                        if let Some(name) = consent::known_cmp(&name) {
                            detection.cmp = Some(name);
                            detection.popup = true;
                        }
                        return Ok(detection);
                    }
                    EngineMsg::PopupFound(_) => {}
                    EngineMsg::Done | EngineMsg::Error => return Ok(detection),
                    // Counted only as the answer to Rust's own pending optIn.
                    EngineMsg::OptInResult(result) => {
                        if let Some(clicked) = self.consent_bridge.on_opt_in_result(result) {
                            detection.clicked = clicked;
                            return Ok(detection);
                        }
                    }
                }
            }
            if cancel.is_cancelled() || Instant::now() >= deadline {
                return Ok(detection);
            }
            self.settle(CANCEL_POLL, cancel, Instant::now() + ARM_DRAIN_BUDGET)
                .await?;
        }
    }

    /// Steps 1–5 of [`Driver::detect_consent`]: `Some(context)` once the shim
    /// and the engine run in the isolated world.
    async fn start_engine(&mut self, session: &SessionId) -> Result<Option<i64>, CdpError> {
        let page = Some(session.clone());
        self.call(page.clone(), MethodId::from("Runtime.enable"), serde_json::json!({}))
            .await?;
        let tree = self
            .call(page.clone(), MethodId::from("Page.getFrameTree"), serde_json::json!({}))
            .await?;
        let Some(frame_id) = tree
            .get("frameTree")
            .and_then(|t| t.get("frame"))
            .and_then(|f| f.get("id"))
            .and_then(|i| i.as_str())
            .map(|i| tame(i, 128))
            .filter(|i| !i.is_empty())
        else {
            return Ok(None);
        };
        self.call(
            page.clone(),
            MethodId::from("Runtime.addBinding"),
            serde_json::json!({ "name": consent::BINDING, "executionContextName": consent::WORLD }),
        )
        .await?;
        let world = self
            .call(
                page,
                MethodId::from("Page.createIsolatedWorld"),
                serde_json::json!({
                    "frameId": frame_id,
                    "worldName": consent::WORLD,
                    "grantUniveralAccess": false,
                }),
            )
            .await?;
        let Some(context) = world.get("executionContextId").and_then(|c| c.as_i64()) else {
            return Ok(None);
        };
        // Recorded before the engine runs: it sends `init` while it loads.
        self.consent_context = Some(context);
        for script in [consent::SHIM, consent::ENGINE] {
            if self
                .bridge_eval(session, script.to_string(), Some(context))
                .await?
                .is_none()
            {
                return Ok(None);
            }
        }
        Ok(Some(context))
    }

    /// Spec §5.1 (1): accepts by the rule of the CMP whose popup the engine
    /// found. Rust sends `optIn` itself, counts a click only from the
    /// [`Bridge`]-checked answer to it, and switches the phase on its own
    /// step: everything first seen from the send on is `After`, and given
    /// back to `Before` if no click came of it.
    ///
    /// A rule that can report success without clicking is never asked —
    /// see [`consent::opt_in_clicks`]. Where the engine did not click (no
    /// popup, or a refused rule) the text click is tried instead.
    async fn consent_step(
        &mut self,
        session: &SessionId,
        cancel: &CancellationToken,
        entry_url: &str,
        detection: Detection,
    ) -> Result<Consent, CdpError> {
        let cmp = match &detection.cmp {
            Some(cmp) if detection.popup && !cancel.is_cancelled() => cmp.clone(),
            _ => {
                let found = consent_found(detection, cancel.is_cancelled());
                return self.text_click(session, cancel, entry_url, found).await;
            }
        };
        if !consent::opt_in_clicks(&cmp) {
            // A rule that cannot prove its click is where most refused CMPs land.
            let refused = Consent {
                cmp: Some(cmp),
                reason: Some("click-failed"),
                ..Consent::default()
            };
            return self.text_click(session, cancel, entry_url, refused).await;
        }
        self.begin_consent_attempt();
        self.load_fired = false;
        // Whatever the engine said before it was asked is not the answer.
        // Queued evals stay: the engine still waits for them.
        self.consent_inbox
            .retain(|m| !matches!(m, EngineMsg::OptInResult(_)));
        let opt_in = self.consent_bridge.request_opt_in().to_string();
        let mut clicked = false;
        if self.consent_reply(session, opt_in).await? {
            let deadline = Instant::now() + OPT_IN_BUDGET;
            clicked = self.relay(session, cancel, deadline, detection).await?.clicked;
        }
        if !clicked {
            self.abandon_consent_attempt();
        }
        Ok(Consent {
            cmp: Some(cmp.clone()),
            clicked,
            rule: clicked.then_some(ConsentRule::Cmp),
            rule_name: if clicked { cmp } else { String::new() },
            matched_text: String::new(),
            click_navigated: self.load_fired,
            // A cancel, or a bridge that died (gap noted), is a blank: the
            // engine never answered, and a click may even have happened.
            reason: (!clicked && !cancel.is_cancelled() && self.consent_context.is_some())
                .then_some("click-failed"),
        })
    }

    /// Spec §5.1 (2)–(3): one click on a whole label from the fixed
    /// vocabulary, inside a consent container, evaluated in the engine's
    /// isolated world. `unclicked` is what the scan reports if nothing is
    /// clicked. A world that is gone, or a cancel, is left as it was: the
    /// expression runs only in that world, never in the page's own.
    ///
    /// A click that loads a page, or leaves the URL the page had, is kept but
    /// flagged `click_navigated`; the caller's reload brings the scan home.
    async fn text_click(
        &mut self,
        session: &SessionId,
        cancel: &CancellationToken,
        entry_url: &str,
        unclicked: Consent,
    ) -> Result<Consent, CdpError> {
        let Some(context) = self.consent_context.filter(|_| !cancel.is_cancelled()) else {
            return Ok(unclicked);
        };
        // Where the page is now, not the URL asked for: a home that
        // redirected on load has not been navigated by the click.
        let before = self.current_url(session).await?;
        self.begin_consent_attempt();
        self.load_fired = false;
        let answer = self
            .bridge_eval(session, consent::text_click_expr(), Some(context))
            .await?;
        let label = answer
            .as_ref()
            .and_then(|r| r.get("result")?.get("value"))
            .and_then(consent::sanitise_text_click);
        let Some(label) = label else {
            self.abandon_consent_attempt();
            if answer.is_none() {
                // No answer: whether it clicked is not known — a blank.
                self.gaps.note("consent:bridge");
                return Ok(Consent { reason: None, ..unclicked });
            }
            return Ok(unclicked);
        };
        self.settle(SETTLE_AFTER_LOAD, cancel, Instant::now() + ARM_DRAIN_BUDGET)
            .await?;
        let before = before.as_deref().unwrap_or(entry_url);
        let moved = self.current_url(session).await?.is_some_and(|url| {
            origin(&url) != origin(before) || canonical(&url) != canonical(before)
        });
        Ok(Consent {
            cmp: unclicked.cmp,
            clicked: true,
            rule: Some(ConsentRule::Text),
            rule_name: String::new(),
            matched_text: label,
            click_navigated: self.load_fired || moved,
            reason: None,
        })
    }

    /// The page's current URL, `entries[currentIndex].url` of
    /// `Page.getNavigationHistory`; `None` when it cannot be read.
    async fn current_url(&mut self, session: &SessionId) -> Result<Option<String>, CdpError> {
        let history = match self
            .call(
                Some(session.clone()),
                MethodId::from("Page.getNavigationHistory"),
                serde_json::json!({}),
            )
            .await
        {
            Ok(history) => history,
            Err(CdpError::BrowserGone) => return Err(CdpError::BrowserGone),
            Err(_) => return Ok(None),
        };
        let index = history.get("currentIndex").and_then(|i| i.as_u64());
        Ok(index
            .and_then(|i| history.get("entries")?.get(i as usize)?.get("url")?.as_str())
            .map(str::to_string))
    }

    /// The consent step is over: the engine's world is no longer read, so
    /// its later messages (it keeps reporting until the page goes) take no
    /// place in the inbox, and Runtime is disabled — nothing later needs its
    /// events; `Runtime.evaluate` works without it. A refused disable
    /// changes nothing the scan reports.
    async fn end_consent(&mut self, session: &SessionId) -> Result<(), CdpError> {
        self.consent_context = None;
        self.consent_inbox.clear();
        match self
            .call(Some(session.clone()), MethodId::from("Runtime.disable"), serde_json::json!({}))
            .await
        {
            Err(CdpError::BrowserGone) => Err(CdpError::BrowserGone),
            _ => Ok(()),
        }
    }

    /// Evaluates a reply to the engine in its isolated world. `false`, with
    /// the `consent:bridge` gap noted and the world no longer read, when it
    /// did not run.
    async fn consent_reply(&mut self, session: &SessionId, reply: String) -> Result<bool, CdpError> {
        // No world, no reply: never fall back to the page's main world.
        let Some(context) = self.consent_context else {
            return Ok(false);
        };
        let ran = self.bridge_eval(session, reply, Some(context)).await?.is_some();
        if !ran {
            // The bridge is gone: stop reading its world.
            self.consent_context = None;
            self.consent_inbox.clear();
            self.gaps.note("consent:bridge");
        }
        Ok(ran)
    }

    /// Evaluates the fixed [`FORM_PROBE`] on `session` and folds the result
    /// through [`sanitise_form_fields`], attributing every retained field to
    /// `page_url`.
    ///
    /// [B2]: the same call contract as [`Driver::links`]
    /// — `return_by_value`, `silent`, `await_promise: false`, an explicit
    /// 2000 ms timeout. `exceptionDetails` present, or any `CdpError` other
    /// than [`CdpError::BrowserGone`], is zero fields plus one counted gap.
    ///
    /// **[B4]** Callers must only ever pass `session` for the page's own
    /// top-level session, never any attached cross-origin iframe session —
    /// that would capture a third party's fields under the scanned site's
    /// name — and only after [`Driver::visit`] returned `true` for `page_url`.
    async fn probe_form_fields(
        &mut self,
        session: &SessionId,
        page_url: &str,
    ) -> Result<Vec<FormField>, CdpError> {
        let Some(value) = self.probe_value(session, FORM_PROBE, "form_fields").await? else {
            return Ok(Vec::new());
        };
        let (fields, sanitiser_gap) =
            sanitise_form_fields(page_url, &value, self.form_fields.len());
        if sanitiser_gap {
            self.gaps.note("form_fields:sanitiser");
        }
        Ok(fields)
    }

    /// Evaluates the fixed [`IFRAME_PROBE`] and folds the result through
    /// [`sanitise_iframes`]. The same call contract and the same [B4] rules as
    /// [`Driver::probe_form_fields`]: top-level session only, only for a page
    /// that was loaded and judged on-site.
    async fn probe_iframes(
        &mut self,
        session: &SessionId,
        page_url: &str,
    ) -> Result<Vec<IframeSeen>, CdpError> {
        let Some(value) = self.probe_value(session, IFRAME_PROBE, "iframes").await? else {
            return Ok(Vec::new());
        };
        let (frames, gap) = sanitise_iframes(page_url, &value);
        if gap {
            self.gaps.note(format!("iframes:sanitiser:{}", page_identity(page_url)));
        }
        Ok(frames)
    }

    /// Runs a fixed probe expression under the [B2] contract and returns its
    /// value; `None` for a refused call or `exceptionDetails`, each a counted
    /// gap named `<label>:probe-failed` / `<label>:probe-exception`.
    async fn probe_value(
        &mut self,
        session: &SessionId,
        expression: &'static str,
        label: &str,
    ) -> Result<Option<serde_json::Value>, CdpError> {
        let mut params = EvaluateParams::new(expression.to_string());
        params.return_by_value = Some(true);
        params.silent = Some(true);
        params.await_promise = Some(false);
        params.timeout = Some(chromiumoxide::cdp::js_protocol::runtime::TimeDelta::new(
            2000.0,
        ));
        let result = match self
            .call(
                Some(session.clone()),
                MethodId::from(EvaluateParams::IDENTIFIER),
                to_params(&params)?,
            )
            .await
        {
            Ok(result) => result,
            Err(CdpError::BrowserGone) => return Err(CdpError::BrowserGone),
            Err(_) => {
                self.gaps.note(format!("{label}:probe-failed"));
                return Ok(None);
            }
        };
        if result.get("exceptionDetails").is_some() {
            self.gaps.note(format!("{label}:probe-exception"));
            return Ok(None);
        }
        Ok(result.get("result").and_then(|r| r.get("value")).cloned())
    }

    /// Evaluates the fixed [`STORAGE_PROBE`] on `session` and folds the
    /// result through [`sanitise_storage_keys`], deduplicating against every
    /// key this scan has already retained.
    ///
    /// [B2]: the same call contract as [`Driver::links`]/
    /// [`Driver::probe_form_fields`] — `return_by_value`, `silent`,
    /// `await_promise: false`, an explicit 2000 ms timeout. `exceptionDetails`
    /// present, or any `CdpError` other than [`CdpError::BrowserGone`], is
    /// zero keys plus one counted gap.
    ///
    /// **[B4]** Callers must only ever pass `session` for the page's own
    /// top-level session, never any attached cross-origin iframe session —
    /// that would capture a third party's storage keys and attribute them to
    /// the scanned site — and only after [`Driver::visit`] returned `true`.
    async fn probe_storage_keys(&mut self, session: &SessionId) -> Result<Vec<StorageKey>, CdpError> {
        let mut params = EvaluateParams::new(STORAGE_PROBE.to_string());
        params.return_by_value = Some(true);
        params.silent = Some(true);
        params.await_promise = Some(false);
        params.timeout = Some(chromiumoxide::cdp::js_protocol::runtime::TimeDelta::new(
            2000.0,
        ));
        let result = match self
            .call(
                Some(session.clone()),
                MethodId::from(EvaluateParams::IDENTIFIER),
                to_params(&params)?,
            )
            .await
        {
            Ok(result) => result,
            Err(CdpError::BrowserGone) => return Err(CdpError::BrowserGone),
            Err(_) => {
                self.gaps.note("storage_keys:probe-failed");
                return Ok(Vec::new());
            }
        };
        if result.get("exceptionDetails").is_some() {
            self.gaps.note("storage_keys:probe-exception");
            return Ok(Vec::new());
        }
        let Some(value) = result.get("result").and_then(|r| r.get("value")) else {
            return Ok(Vec::new());
        };
        let (keys, sanitiser_gap) = sanitise_storage_keys(value, &self.storage_keys);
        if sanitiser_gap {
            self.gaps.note("storage_keys:sanitiser");
        }
        Ok(keys)
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
            return self.finish(0, true).await;
        };

        // `max_pages` counts the entry page, so a budget of zero loads
        // nothing rather than loading one page anyway.
        let mut pages_visited = 0u32;
        if cancel.is_cancelled() || max_pages == 0 {
            return self.finish(pages_visited, cancel.is_cancelled()).await;
        }
        if self.visit(&session, entry_url, HOME_WAIT, cancel).await? {
            pages_visited += 1;
            // [B4] Only for a page this walk actually loaded, only on the
            // page's own top-level session, and attributed to `entry_url` as
            // the walk itself knows it — never to anything the page's own
            // `location` might report.
            if !cancel.is_cancelled() {
                let fields = self.probe_form_fields(&session, entry_url).await?;
                self.form_fields.extend(fields);
                let frames = self.probe_iframes(&session, entry_url).await?;
                self.iframes.extend(frames);
            }
            // [B4] Same discipline as the form-field probe above: only a page
            // this walk actually loaded, only on the page's own top-level
            // session.
            if !cancel.is_cancelled() {
                let keys = self.probe_storage_keys(&session).await?;
                self.storage_keys.extend(keys);
            }
            if !cancel.is_cancelled() {
                self.snapshot_before_cookies().await?;
            }
            // Once, on the entry page's own session — the banner is a
            // site-level fact, not a per-page one.
            if !cancel.is_cancelled() {
                let detection = self.detect_consent(&session, cancel).await?;
                self.consent = self.consent_step(&session, cancel, entry_url, detection).await?;
                self.end_consent(&session).await?;
                // Reloaded so the tags that wait for consent load. Not a new
                // page: not counted, not probed again.
                if self.consent.clicked && !cancel.is_cancelled() {
                    self.visit(&session, entry_url, SETTLE_AFTER_LOAD, cancel).await?;
                }
            }
        }

        if cancel.is_cancelled() || max_pages <= 1 {
            return self.finish(pages_visited, cancel.is_cancelled()).await;
        }
        let links = self.links(&session).await?;
        let refs: Vec<(&str, &str)> = links.iter().map(|(h, t)| (h.as_str(), t.as_str())).collect();
        let (offsite, capped) = offsite_links(entry_url, &refs);
        if capped {
            self.gaps.note("offsite_links:cap");
        }
        self.offsite_links = offsite;
        let follow = pick_pages(entry_url, &refs, (max_pages - 1) as usize);
        let entry_origin = origin(entry_url);
        for (n, (url, purpose)) in follow.into_iter().enumerate() {
            if cancel.is_cancelled() {
                break;
            }
            let before = self.acc.clone();
            if self.visit(&session, &url, SETTLE_AFTER_LOAD, cancel).await? {
                // A same-origin link can redirect away. Where the page ended
                // up decides: an off-site page is not probed, not counted, and
                // the hosts first seen while on it are given back.
                let landed = self.current_url(&session).await?;
                // Unreadable history is the same: a blank beats a guess.
                match landed {
                    Some(u) if origin(&u) == entry_origin => {}
                    other => {
                        self.acc = before;
                        let kind = if other.is_some() { "offsite" } else { "history" };
                        self.gaps.note(format!("page:{kind}:{n}"));
                        continue;
                    }
                }
                pages_visited += 1;
                self.pages.push(VisitedPage { page: page_identity(&url), purpose });
                if !cancel.is_cancelled() {
                    let fields = self.probe_form_fields(&session, &url).await?;
                    self.form_fields.extend(fields);
                    let frames = self.probe_iframes(&session, &url).await?;
                    self.iframes.extend(frames);
                }
                if !cancel.is_cancelled() {
                    let keys = self.probe_storage_keys(&session).await?;
                    self.storage_keys.extend(keys);
                }
            }
        }
        self.finish(pages_visited, cancel.is_cancelled()).await
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
            // Never fetched here — see the field's own doc comment.
            cookies: Vec::new(),
            consent: std::mem::take(&mut self.consent),
            form_fields: std::mem::take(&mut self.form_fields),
            storage_keys: std::mem::take(&mut self.storage_keys),
            pages: std::mem::take(&mut self.pages),
            iframes: std::mem::take(&mut self.iframes),
            offsite_links: std::mem::take(&mut self.offsite_links),
        }
    }

    /// Sends `Storage.getCookies` on the browser-level session — a fixed
    /// method string, no parameters built from anything the page said — and
    /// folds the result through [`sanitise_cookies`].
    ///
    /// [B2]: every `CdpError` here except [`CdpError::BrowserGone`] is
    /// swallowed into zero cookies plus a reported gap, the same rule as
    /// every other probe call in this module. `BrowserGone` is propagated: a
    /// browser that died mid-scan fails the scan regardless of which command
    /// was in flight when it happened.
    async fn fetch_cookies(&mut self) -> Result<(Vec<ScanCookie>, bool), CdpError> {
        match self
            .call(
                None,
                MethodId::from("Storage.getCookies"),
                serde_json::json!({}),
            )
            .await
        {
            Ok(result) => {
                let raw: Vec<serde_json::Value> = result
                    .get("cookies")
                    .and_then(|c| c.as_array())
                    .cloned()
                    .unwrap_or_default();
                // A response with no `cookies` array at all is itself a gap:
                // nothing here trusts the shape of what a browser answers.
                let malformed = result.get("cookies").and_then(|c| c.as_array()).is_none();
                let (cookies, sanitiser_gap) = sanitise_cookies(&raw);
                Ok((cookies, sanitiser_gap || malformed))
            }
            Err(CdpError::BrowserGone) => Err(CdpError::BrowserGone),
            Err(_) => Ok((Vec::new(), true)),
        }
    }

    /// Snapshot 1: the cookies on the home page before any click. Only their
    /// `(name, domain)` pairs are kept, to tag snapshot 2.
    async fn snapshot_before_cookies(&mut self) -> Result<(), CdpError> {
        let (cookies, gap) = self.fetch_cookies().await?;
        if gap {
            self.gaps.note("cookies:gap");
            return Ok(());
        }
        self.before_cookies = Some(cookies.into_iter().map(|c| (c.name, c.domain)).collect());
        Ok(())
    }

    /// The one place that builds the [`Observation`] a completed, cancelled,
    /// or budget-exhausted `run()` actually returns: folds in the cookie
    /// jar at snapshot 2, rather than in [`Driver::observation`] itself. A
    /// cookie in snapshot 1 is `Before`; with no successful click every cookie
    /// is `Before`; otherwise a cookie not in snapshot 1 is `After` — or has no
    /// phase at all when snapshot 1 is unknown, because a blank beats a guess.
    async fn finish(
        &mut self,
        pages_visited: u32,
        stopped_early: bool,
    ) -> Result<Observation, CdpError> {
        let (mut cookies, gap) = self.fetch_cookies().await?;
        if gap {
            self.gaps.note("cookies:gap");
        }
        for c in &mut cookies {
            let pair = (c.name.clone(), c.domain.clone());
            c.phase = match (&self.before_cookies, self.phase) {
                (_, Phase::Before) => Some(Phase::Before),
                (Some(before), _) if before.contains(&pair) => Some(Phase::Before),
                (Some(_), phase) => Some(phase),
                (None, _) => None,
            };
        }
        let mut observation = self.observation(pages_visited, stopped_early);
        observation.cookies = cookies;
        Ok(observation)
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
        acc.record("https://www.google-analytics.com/collect?v=1", Phase::Before);
        acc.record("https://www.google-analytics.com/collect?v=2", Phase::Before);
        acc.record("https://doubleclick.net/pixel.gif", Phase::Before);
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
        acc.record("https://WWW.Example.COM/a", Phase::Before);
        acc.record("https://www.example.com/b", Phase::Before);
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
            acc.record(u, Phase::Before);
        }
        assert!(acc.finish().is_empty());
    }

    #[test]
    fn strips_the_port_and_userinfo_from_a_host() {
        let mut acc = HostAccumulator::new();
        acc.record("https://user:pw@example.com:8443/x", Phase::Before);
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
            a.record(u, Phase::Before);
        }
        let mut b = HostAccumulator::new();
        for u in [
            "https://c.example/1",
            "https://a.example/1",
            "https://b.example/1",
        ] {
            b.record(u, Phase::Before);
        }
        let names_a: Vec<_> = a.finish().into_iter().map(|h| h.host).collect();
        let names_b: Vec<_> = b.finish().into_iter().map(|h| h.host).collect();
        assert_eq!(names_a, names_b);
    }

    fn pick(entry: &str, links: &[&str], limit: usize) -> Vec<String> {
        let pairs: Vec<(&str, &str)> = links.iter().map(|l| (*l, "")).collect();
        pick_pages(entry, &pairs, limit).into_iter().map(|p| p.0).collect()
    }

    #[test]
    fn files_and_credentialed_or_backslashed_links_are_never_picked() {
        let site = concat!("https", "://site.it");
        let l = |p: &str| format!("{site}{p}");
        let userinfo = concat!("https", "://user:pass@site.it/contatti");
        let backslash = concat!("https", "://site.it/a\\b");
        let links = [
            l("/contatti.pdf"),
            l("/film.MP4"),
            l("/a.docx"),
            userinfo.to_string(),
            backslash.to_string(),
            l("/ok"),
        ];
        let refs: Vec<&str> = links.iter().map(|s| s.as_str()).collect();
        assert_eq!(pick(&l("/"), &refs, 20), vec![l("/ok")]);
    }

    #[test]
    fn more_matches_follow_by_score_then_document_order() {
        let site = concat!("https", "://site.it");
        let l = |p: &str| format!("{site}{p}");
        let links = [
            (l("/x"), "Contatti"),
            (l("/plain"), "Home"),
            (l("/contatti"), ""),
            (l("/contatto"), ""),
            (l("/contact-us"), "Contact"),
            (l("/prenota"), ""),
            (l("/book"), ""),
        ];
        let refs: Vec<(&str, &str)> = links.iter().map(|(a, b)| (a.as_str(), *b)).collect();
        let got: Vec<String> = pick_pages(&l("/"), &refs, 20).into_iter().map(|p| p.0).collect();
        assert_eq!(
            got,
            ["/contact-us", "/prenota", "/contatti", "/contatto", "/book", "/x", "/plain"]
                .map(l)
                .to_vec()
        );
    }

    #[test]
    fn facebook_is_not_booking() {
        assert_eq!(purpose_of("/facebook", "Facebook"), None);
        assert_eq!(purpose_of("/book-a-table", ""), Some((Purpose::Booking, 2)));
    }

    #[test]
    fn multi_word_keywords_match_as_a_sequence_in_path_or_text() {
        assert_eq!(purpose_of("/lavora-con-noi/", "").map(|p| p.0), Some(Purpose::Careers));
        assert_eq!(purpose_of("/pagina-7", "Lavora con noi").map(|p| p.0), Some(Purpose::Careers));
        assert_eq!(purpose_of("/noi", "Chi siamo"), None);
    }

    #[test]
    fn picks_best_per_purpose_then_more_matches_then_document_order() {
        let site = concat!("https", "://site.it");
        let l = |p: &str| format!("{site}{p}");
        let links = [
            (l("/chi-siamo"), "Chi siamo"),
            (l("/contatti"), "Contatti"),
            (l("/blog"), "Blog"),
            (l("/prenota"), "Prenota ora"),
            (l("/facebook"), "Facebook"),
            (l("/listino.pdf"), "Listino"),
            (l("/contatti?print=1"), "Stampa"),
            ("mailto:a@site.it".to_string(), "Scrivici"),
            (concat!("https", "://other.it/contact").to_string(), "Contact"),
        ];
        let refs: Vec<(&str, &str)> = links.iter().map(|(a, b)| (a.as_str(), *b)).collect();
        let got: Vec<String> = pick_pages(&l("/"), &refs, 4).into_iter().map(|p| p.0).collect();
        assert_eq!(got, vec![l("/contatti"), l("/prenota"), l("/chi-siamo"), l("/blog")]);
    }

    #[test]
    fn same_origin_links_are_followed_and_others_are_not() {
        let links = [
            "https://rossi-editore.it/about",
            "https://rossi-editore.it/news",
            "https://www.rossi-editore.it/other",
            "https://facebook.com/rossi",
            "mailto:info@rossi-editore.it",
            "javascript:void(0)",
            "#anchor",
        ];
        let next = pick("https://rossi-editore.it/", &links, 10);
        assert_eq!(
            next,
            vec![
                "https://rossi-editore.it/about",
                "https://rossi-editore.it/news"
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
            pick("https://rossi-editore.it/", &refs, 10).len(),
            10
        );
    }

    #[test]
    fn does_not_follow_the_entry_page_again() {
        let next = pick(
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
        /// Per-method answers used once each, in order, before `results` —
        /// a method whose answer changes between two calls.
        queued: HashMap<String, VecDeque<serde_json::Value>>,
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
                queued: HashMap::new(),
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
                            self.queued
                                .get_mut(method.as_ref())
                                .and_then(VecDeque::pop_front)
                                .or_else(|| self.results.get(method.as_ref()).cloned())
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
    async fn a_service_worker_is_attached_by_the_browser_session_only() {
        // Sites 00, 21, 30, 49 (docs/decisions/2026-09-29-scanner-failures.md): a worker attached
        // by both the browser and a page session stays paused until both resume it, and the
        // one-in-flight driver deadlocks on `Network.enable`. The page session must exclude it;
        // the browser session must keep it, or the worker is not observed at all.
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
        driver
            .run("https://rossi-editore.it/", 0, &CancellationToken::new())
            .await
            .expect("run");

        let session = driver
            .transport
            .params_for("Target.setAutoAttach", Some("SESSION-A"))
            .expect("session-level setAutoAttach");
        assert_eq!(
            session["filter"],
            json!([{"type": "service_worker", "exclude": true}, {}])
        );
        assert_eq!(session["flatten"], json!(true));
        let browser = driver
            .transport
            .params_for("Target.setAutoAttach", None)
            .expect("browser-level setAutoAttach");
        assert!(browser.get("filter").is_none(), "{browser}");
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
            expression.contains(&format!("slice(0, {MAX_LINK_LEN})")),
            "the per-href length cap is gone: {expression}"
        );
        assert!(
            expression.contains(&format!("slice(0, {MAX_LINK_TEXT})")),
            "the anchor text cap is gone: {expression}"
        );
        assert!(
            expression.contains(&format!("slice(0, {MAX_LINKS_READ})")),
            "the link count cap is gone: {expression}"
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
            acc.record(bad, Phase::Before);
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
            acc.record(good, Phase::Before);
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
        acc.record(&format!("https://{long}.example/x"), Phase::Before);
        assert!(acc.finish().is_empty());
        // The paired control: 253 bytes is the DNS limit and must still work.
        let mut acc = HostAccumulator::new();
        acc.record(&format!("https://{}/x", "b".repeat(253)), Phase::Before);
        assert_eq!(acc.finish().len(), 1);
    }

    #[test]
    fn stops_taking_new_hosts_at_the_limit_and_says_so() {
        let mut acc = HostAccumulator::new();
        for i in 0..(MAX_HOSTS + 10) {
            acc.record(&format!("https://h{i}.example/x"), Phase::Before);
        }
        assert!(acc.overflowed(), "the overflow must be visible, not silent");
        assert_eq!(acc.finish().len(), MAX_HOSTS);
    }

    #[tokio::test]
    async fn a_host_list_that_hit_its_limit_is_reported_as_a_possible_gap() {
        let mut driver = Driver::new(FakeTransport::new());
        for i in 0..(MAX_HOSTS + 1) {
            driver.acc.record(&format!("https://h{i}.example/x"), Phase::Before);
        }
        assert_eq!(driver.observation(1, false).possible_gaps, 1);
    }

    #[test]
    fn strips_one_trailing_dot_so_the_host_matches_the_proxy_ledger() {
        // I-3. admission.rs strips exactly one trailing dot and the ledger
        // lowercases. A host recorded here as "example.com." would split its
        // count against the undotted form and miss Task 9's dictionary.
        let mut acc = HostAccumulator::new();
        acc.record("https://www.google-analytics.com./collect", Phase::Before);
        acc.record("https://www.google-analytics.com/collect", Phase::Before);
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
        assert!(pick(
            "https://rossi-editore.it/",
            &["https://rossi-editore.it/a"],
            0
        )
        .is_empty());
    }

    #[test]
    fn a_default_port_does_not_make_a_second_origin() {
        // M-4. https://x.example:443/b is the same origin as https://x.example/b.
        let next = pick(
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
        assert!(pick(
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
        acc.counts.insert("x.example".to_string(), (u32::MAX, Phase::Before));
        acc.record("https://x.example/a", Phase::Before);
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
        let next = pick(
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
                phase: Phase::Before,
            }],
            pages_visited: 4,
            possible_gaps: 0,
            stopped_early: false,
            cookies: Vec::new(),
            consent: Consent::default(),
            form_fields: Vec::new(),
            storage_keys: Vec::new(),
            pages: Vec::new(),
            iframes: Vec::new(),
            offsite_links: Vec::new(),
        };
        assert_eq!(
            serde_json::to_value(&observation).expect("json"),
            json!({
                "hosts": [{"host": "doubleclick.net", "requestCount": 3, "phase": "before"}],
                "pagesVisited": 4,
                "possibleGaps": 0,
                "stoppedEarly": false,
                "cookies": [],
                "consent": {"cmp": null, "clicked": false, "rule": null, "ruleName": "",
                            "matchedText": "", "clickNavigated": false},
                "formFields": [],
                "storageKeys": [],
                "pages": [],
                "iframes": [],
                "offsiteLinks": []
            })
        );
    }

    // --- Task 5: the cookie jar ---

    #[tokio::test]
    async fn cookies_are_read_with_storage_get_cookies_on_the_browser_session() {
        // Current Chrome answers `Network.getAllCookies` with "wasn't found";
        // FakeTransport answers by method, so a reverted string gets `{}` here.
        let mut t = FakeTransport::new();
        t.results.insert(
            "Storage.getCookies".into(),
            json!({ "cookies": [{ "name": "_ga", "domain": ".example.it", "session": false, "expires": 1.9e9 }] }),
        );
        let mut d = Driver::new(t);
        let (cookies, gap) = d.fetch_cookies().await.unwrap();
        assert_eq!((cookies.len(), gap), (1, false));
        assert!(d.transport.methods_for(None).contains(&"Storage.getCookies"));
    }

    #[tokio::test]
    async fn a_refused_cookie_read_is_a_gap_never_a_silent_zero() {
        let mut t = FakeTransport::new();
        t.refuse_on("Storage.getCookies", None);
        let mut d = Driver::new(t);
        let (cookies, gap) = d.fetch_cookies().await.unwrap();
        assert!(cookies.is_empty() && gap);
        // The gap must come from the refusal, not from `{}` answering some
        // other method string (a missing `cookies` array is a gap too).
        assert_eq!(d.transport.methods_for(None), ["Storage.getCookies"]);
    }

    // --- Task 4: phases ---

    #[test]
    fn a_host_keeps_the_first_phase_it_was_seen_in() {
        let mut acc = HostAccumulator::default();
        acc.record("https://a.example/x", Phase::Before);
        acc.record("https://a.example/y", Phase::After);
        acc.record("https://b.example/", Phase::After);
        let h = acc.finish();
        assert_eq!(h.iter().find(|x| x.host == "a.example").unwrap().phase, Phase::Before);
        assert_eq!(h.iter().find(|x| x.host == "b.example").unwrap().phase, Phase::After);
    }

    #[test]
    fn a_failed_consent_attempt_leaves_everything_before() {
        let mut d = Driver::new(FakeTransport::new());
        d.acc.record("https://pre.example/", d.phase);
        d.begin_consent_attempt();
        d.acc.record("https://during.example/", d.phase);
        d.abandon_consent_attempt();
        d.acc.record("https://later.example/", d.phase);
        let hosts = std::mem::take(&mut d.acc).finish();
        assert_eq!(hosts.len(), 3);
        assert!(hosts.iter().all(|h| h.phase == Phase::Before));
    }

    #[tokio::test]
    async fn a_cookie_present_at_the_first_snapshot_stays_before() {
        let a = json!({ "name": "A", "domain": ".site.example", "session": true, "expires": -1.0 });
        let b = json!({ "name": "B", "domain": ".ads.example", "session": false, "expires": 2e9 });
        let mut t = FakeTransport::new();
        t.queued.insert(
            "Storage.getCookies".into(),
            VecDeque::from([json!({ "cookies": [a.clone()] }), json!({ "cookies": [a, b] })]),
        );
        let mut d = Driver::new(t);
        d.snapshot_before_cookies().await.unwrap();
        d.begin_consent_attempt();
        let observation = d.finish(1, false).await.unwrap();
        let phase = |n: &str| observation.cookies.iter().find(|c| c.name == n).unwrap().phase;
        assert_eq!(phase("A"), Some(Phase::Before));
        assert_eq!(phase("B"), Some(Phase::After));
        assert_eq!(d.transport.methods_for(None), ["Storage.getCookies", "Storage.getCookies"]);
    }

    /// Snapshot 1 refused, snapshot 2 answered with one cookie.
    async fn after_a_refused_first_snapshot(attempt: bool) -> Option<Phase> {
        let mut t = FakeTransport::new();
        t.refuse_on("Storage.getCookies", None);
        t.results.insert(
            "Storage.getCookies".into(),
            json!({ "cookies": [{ "name": "A", "domain": ".site.example", "session": true, "expires": -1.0 }] }),
        );
        let mut d = Driver::new(t);
        d.snapshot_before_cookies().await.unwrap();
        d.transport.refuse.clear();
        if attempt {
            d.begin_consent_attempt();
        }
        let observation = d.finish(1, false).await.unwrap();
        observation.cookies[0].phase
    }

    #[tokio::test]
    async fn a_missing_first_snapshot_leaves_a_cookie_after_a_click_without_a_phase() {
        assert_eq!(after_a_refused_first_snapshot(true).await, None);
    }

    #[tokio::test]
    async fn a_missing_first_snapshot_without_a_click_is_still_before() {
        assert_eq!(after_a_refused_first_snapshot(false).await, Some(Phase::Before));
    }

    #[test]
    fn a_second_begin_keeps_the_first_attempts_known_hosts() {
        let mut d = Driver::new(FakeTransport::new());
        d.acc.record("https://pre.example/", d.phase);
        d.begin_consent_attempt();
        d.acc.record("https://first-try.example/", d.phase);
        d.begin_consent_attempt();
        d.abandon_consent_attempt();
        let hosts = std::mem::take(&mut d.acc).finish();
        assert!(hosts.iter().all(|h| h.phase == Phase::Before));
    }

    #[test]
    fn a_thousand_minted_cookies_cap_at_max_and_record_a_gap() {
        let raw: Vec<serde_json::Value> = (0..1000)
            .map(|i| {
                json!({"name": format!("c{i}"), "domain": "evil.example", "session": false, "expires": 2e9})
            })
            .collect();
        let (cookies, gap) = sanitise_cookies(&raw);
        assert_eq!(cookies.len(), MAX_COOKIES);
        assert!(gap, "hitting the cap must surface as a gap, never a clean sheet");
    }

    #[test]
    fn control_characters_and_bidi_overrides_are_tamed_and_lengths_bounded() {
        let raw = vec![json!({
            "name": "a\u{0007}b".repeat(400),
            "domain": "x.it",
            "session": true,
            "expires": -1.0
        })];
        let (cookies, _) = sanitise_cookies(&raw);
        assert!(!cookies[0].name.contains('\u{0007}'));
        assert_eq!(cookies[0].name.chars().count(), MAX_COOKIE_NAME);
    }

    #[test]
    fn a_right_to_left_override_at_the_truncation_boundary_is_replaced_not_left_to_rewrite_the_line(
    ) {
        let raw = vec![json!({
            "name": format!("{}\u{202E}", "x".repeat(MAX_COOKIE_NAME - 2)),
            "domain": "x.it",
            "session": true,
            "expires": -1.0
        })];
        let (cookies, _) = sanitise_cookies(&raw);
        assert!(!cookies[0].name.contains('\u{202E}'));
    }

    #[test]
    fn a_cookie_of_invalid_shape_is_dropped_and_counted_not_propagated() {
        let raw = vec![
            json!({"name": 5}),
            json!({"name": "ok", "domain": "x.it", "session": true, "expires": -1.0}),
        ];
        let (cookies, gap) = sanitise_cookies(&raw);
        assert_eq!(cookies.len(), 1);
        assert!(gap);
    }

    #[test]
    fn a_cookie_whose_expiry_is_not_a_number_is_dropped_not_serialised() {
        let raw = vec![json!({
            "name": "ok",
            "domain": "x.it",
            "session": false,
            "expires": f64::NAN
        })];
        let (cookies, gap) = sanitise_cookies(&raw);
        assert_eq!(
            cookies.len(),
            0,
            "a non-finite expires must never reach a ScanCookie"
        );
        assert!(gap);
        for c in &cookies {
            assert!(
                serde_json::to_string(c).is_ok(),
                "no non-finite float ever reaches serde_json::to_string"
            );
        }
    }

    #[test]
    fn serialises_cookies_in_the_shape_the_renderer_expects() {
        let json = serde_json::to_string(&ScanCookie {
            name: "_ga".into(),
            domain: "google.com".into(),
            session: false,
            expires_epoch_seconds: 2.0e9,
            phase: Some(Phase::After),
        })
        .unwrap();
        assert!(json.contains("\"phase\":\"after\""));
        for key in ["\"name\"", "\"domain\"", "\"session\"", "\"expiresEpochSeconds\""] {
            assert!(json.contains(key), "missing {key}");
        }
    }

    #[tokio::test]
    async fn a_transport_that_refuses_runtime_evaluate_yields_a_gap_not_an_error() {
        // [B2] Every CdpError from a probe call except BrowserGone is
        // swallowed into zero results plus one possible_gaps note — the path
        // that keeps a page hanging a probe past its own timeout from turning
        // a whole scan into SCAN_FAILED.
        let mut transport = FakeTransport::new();
        transport.refuse_on("Runtime.evaluate", Some("SESSION-A"));
        let mut driver = Driver::new(transport);
        let session = SessionId::from("SESSION-A".to_string());
        let hrefs = driver
            .links(&session)
            .await
            .expect("a refused probe is a gap, not a scan failure");
        assert!(hrefs.is_empty());
        assert_eq!(driver.observation(1, false).possible_gaps, 1);
    }

    // --- Task 8: form fields ---

    #[test]
    fn the_in_page_slice_matches_the_rust_side_cap() {
        // [B1]. Mirrors caps_the_length_of_each_href_inside_the_page above:
        // capping the element count (64) alone does not bound the bytes a
        // single unsliced DOMString can carry, since chromiumoxide's
        // Connection sets max_frame_size to None. There is one number, used
        // both here and as MAX_FIELD_TEXT.
        //
        // Asserted by *count*, not mere presence: four strings are captured
        // per field (name, type, autocomplete, label) and every one of them
        // must be sliced, so a future edit that adds a fifth captured string
        // without slicing it — or removes the slice from just one of the
        // four — must fail here rather than pass on the other three still
        // matching.
        let needle = format!("slice(0, {MAX_FIELD_TEXT})");
        let count = FORM_PROBE.matches(&needle).count();
        assert_eq!(
            count, 4,
            "expected exactly 4 in-page slices to MAX_FIELD_TEXT (name, type, \
             autocomplete, label), found {count}: {FORM_PROBE}"
        );
    }

    #[test]
    fn a_page_is_reduced_to_scheme_authority_and_path_never_the_pages_own_report() {
        // [B4]. Query and fragment stripped; the value comes from the walk's
        // own URL knowledge, never from anything the page could claim about
        // itself.
        let raw = json!([{
            "name": "email",
            "type": "email",
            "autocomplete": "email",
            "label": "Email",
            // A hostile or merely confused page reporting its own location —
            // must never be read for `page`.
            "location": "https://evil.example/somewhere-else",
        }]);
        let (fields, _) = sanitise_form_fields("https://x.it/c?utm=1&id=abc#frag", &raw, 0);
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].page, "https://x.it/c");
    }

    #[test]
    fn a_page_url_longer_than_max_field_text_survives_untruncated() {
        // Security advisory: `page` must not share MAX_FIELD_TEXT (128) with
        // the short field attributes — a real URL routinely exceeds that,
        // and two distinct long URLs truncated to the same 128-char prefix
        // would merge into one collection point once Task 9 groups by
        // `page`. It gets its own bound, MAX_PAGE_URL, aligned with
        // scan::MAX_URL_LEN (2048).
        let long_path = "a".repeat(200);
        let url = format!("https://x.it/{long_path}");
        assert!(url.len() > MAX_FIELD_TEXT, "the fixture must exceed the old shared bound");
        let raw = json!([{"name": "n", "type": "text", "autocomplete": "off", "label": ""}]);
        let (fields, _) = sanitise_form_fields(&url, &raw, 0);
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].page, url, "a long real URL must not be truncated");
    }

    #[test]
    fn strings_are_tamed_and_bounded_to_max_field_text() {
        let raw = json!([{
            "name": "a\u{0007}b".repeat(200),
            "type": "text",
            "autocomplete": "off",
            "label": format!("{}\u{202E}", "x".repeat(MAX_FIELD_TEXT - 2)),
        }]);
        let (fields, _) = sanitise_form_fields("https://x.it/page", &raw, 0);
        assert_eq!(fields.len(), 1);
        assert!(!fields[0].name.contains('\u{0007}'));
        assert_eq!(fields[0].name.chars().count(), MAX_FIELD_TEXT);
        assert!(!fields[0].label.contains('\u{202E}'));
    }

    #[test]
    fn a_form_field_of_invalid_shape_is_dropped_and_counted_not_propagated() {
        let raw = json!([
            {"name": 5},
            {"name": "ok", "type": "text", "autocomplete": "off", "label": ""},
        ]);
        let (fields, gap) = sanitise_form_fields("https://x.it/", &raw, 0);
        assert_eq!(fields.len(), 1);
        assert!(gap);
    }

    #[test]
    fn hitting_the_scan_wide_cap_records_a_gap_never_a_clean_sheet() {
        // MAX_FORM_FIELDS bounds the whole scan, not one page's probe (which
        // already stops at 64 in FORM_PROBE itself), so the cap is enforced
        // against `already` plus what this call would add.
        let raw: Vec<serde_json::Value> = (0..10)
            .map(|i| {
                json!({"name": format!("f{i}"), "type": "text", "autocomplete": "off", "label": ""})
            })
            .collect();
        let (fields, gap) =
            sanitise_form_fields("https://x.it/", &json!(raw), MAX_FORM_FIELDS - 2);
        assert_eq!(fields.len(), 2);
        assert!(gap, "hitting the cap must surface as a gap, never a clean sheet");
        // 64 fields on each of the 13 pages the scan can visit.
        assert_eq!(MAX_FORM_FIELDS, 64 * 13);
    }

    #[test]
    fn a_non_array_probe_result_yields_no_fields_and_a_gap() {
        let (fields, gap) = sanitise_form_fields("https://x.it/", &json!("not-an-array"), 0);
        assert!(fields.is_empty());
        assert!(gap);
    }

    #[test]
    fn serialises_form_fields_in_the_shape_the_renderer_expects() {
        let json = serde_json::to_string(&FormField {
            page: "https://x.it/contatti".into(),
            name: "email".into(),
            r#type: "email".into(),
            autocomplete: "email".into(),
            label: "Email".into(),
            form: 0,
            action_host: String::new(),
        })
        .unwrap();
        for key in ["\"page\"", "\"name\"", "\"type\"", "\"autocomplete\"", "\"label\"", "\"form\"", "\"actionHost\""] {
            assert!(json.contains(key), "missing {key}");
        }
    }

    #[tokio::test]
    async fn a_transport_that_refuses_the_form_probe_yields_a_gap_not_an_error() {
        // [B2], same call contract as links().
        let mut transport = FakeTransport::new();
        transport.refuse_on("Runtime.evaluate", Some("SESSION-A"));
        let mut driver = Driver::new(transport);
        let session = SessionId::from("SESSION-A".to_string());
        let fields = driver
            .probe_form_fields(&session, "https://x.it/")
            .await
            .expect("a refused probe is a gap, not a scan failure");
        assert!(fields.is_empty());
        assert_eq!(driver.observation(1, false).possible_gaps, 1);
    }

    #[tokio::test]
    async fn visits_the_entry_page_and_attributes_its_form_fields_to_the_walks_own_url() {
        let mut transport = FakeTransport::new();
        transport
            .results
            .insert("Target.createTarget".to_string(), json!({"targetId": "T-1"}));
        transport.inject_on(
            "Target.createTarget",
            None,
            attached_event("SESSION-A", "T-1", "page", true),
        );
        transport.inject_on(
            "Page.navigate",
            Some("SESSION-A"),
            CdpJsonEventMessage {
                method: MethodId::from(EventLoadEventFired::IDENTIFIER),
                session_id: Some("SESSION-A".to_string()),
                params: json!({"timestamp": 0.0}),
            },
        );
        transport.results.insert(
            "Runtime.evaluate".to_string(),
            json!({"result": {"value": [
                {"name": "email", "type": "email", "autocomplete": "email", "label": "Email"}
            ]}}),
        );
        // The post-load settle window reads with no more events queued; a
        // transport that ends the stream there reads as `BrowserGone`
        // (correctly, for a live browser), so this fake — the one transport
        // in this suite that actually drives a `visit()` all the way through
        // a load — has to look like a browser that is merely quiet rather
        // than one that hung up.
        transport.hang_when_empty = true;
        let mut driver = Driver::new(transport);
        let observation = driver
            .run(
                "https://rossi-editore.it/c?utm=1&id=abc#frag",
                1,
                &CancellationToken::new(),
            )
            .await
            .expect("run");
        assert_eq!(
            observation.form_fields,
            vec![FormField {
                page: "https://rossi-editore.it/c".to_string(),
                name: "email".to_string(),
                r#type: "email".to_string(),
                autocomplete: "email".to_string(),
                label: "Email".to_string(),
                form: -1,
                action_host: String::new(),
            }]
        );
    }

    #[tokio::test]
    async fn a_refused_navigation_contributes_no_fields_for_that_page() {
        let mut transport = FakeTransport::new();
        transport
            .results
            .insert("Target.createTarget".to_string(), json!({"targetId": "T-1"}));
        transport.inject_on(
            "Target.createTarget",
            None,
            attached_event("SESSION-A", "T-1", "page", true),
        );
        transport.refuse_on("Page.navigate", Some("SESSION-A"));
        let mut driver = Driver::new(transport);
        let observation = driver
            .run("https://rossi-editore.it/", 1, &CancellationToken::new())
            .await
            .expect("run");
        assert_eq!(observation.pages_visited, 0);
        assert!(observation.form_fields.is_empty());
        assert!(
            !driver
                .transport
                .methods_for(Some("SESSION-A"))
                .contains(&"Runtime.evaluate"),
            "a page whose navigation was refused must never be probed at all"
        );
    }

    // --- Task 10: storage keys ---

    #[test]
    fn the_in_page_slice_of_the_storage_key_matches_the_rust_side_cap() {
        // [B1]. The megabyte-long-key defence: the key is sliced inside the
        // page, at MAX_KEY_LEN, before `store.key(i)` ever becomes a
        // WebSocket frame — the Rust-side cap alone does not bound it.
        let needle = format!("slice(0, {MAX_KEY_LEN})");
        let count = STORAGE_PROBE.matches(&needle).count();
        assert_eq!(
            count, 1,
            "expected exactly 1 in-page slice to MAX_KEY_LEN, found {count}: {STORAGE_PROBE}"
        );
    }

    #[test]
    fn a_thousand_minted_keys_cap_at_max_and_record_a_gap() {
        let raw: Vec<serde_json::Value> = (0..1000)
            .map(|i| json!({"scope": "local", "key": format!("k{i}"), "bytes": 4}))
            .collect();
        let (keys, gap) = sanitise_storage_keys(&json!(raw), &[]);
        assert_eq!(keys.len(), MAX_STORAGE_KEYS);
        assert!(gap, "hitting the cap must surface as a gap, never a clean sheet");
    }

    #[test]
    fn a_megabyte_long_key_is_tamed_and_bounded_to_max_key_len() {
        // Defensive, Rust-side truncation even though STORAGE_PROBE already
        // slices in the page — see [B1].
        let long_key = "a".repeat(1_000_000);
        let raw = json!([{"scope": "local", "key": long_key, "bytes": 4}]);
        let (keys, _) = sanitise_storage_keys(&raw, &[]);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key.chars().count(), MAX_KEY_LEN);
    }

    #[test]
    fn control_and_bidi_characters_in_a_key_are_tamed() {
        let raw = json!([{
            "scope": "session",
            "key": format!("{}\u{202E}", "x".repeat(MAX_KEY_LEN - 1)),
            "bytes": 4,
        }]);
        let (keys, _) = sanitise_storage_keys(&raw, &[]);
        assert_eq!(keys.len(), 1);
        assert!(!keys[0].key.contains('\u{202E}'));
        assert_eq!(keys[0].key.chars().count(), MAX_KEY_LEN);
    }

    #[test]
    fn a_scope_outside_local_or_session_is_dropped_and_counted() {
        let raw = json!([
            {"scope": "cookie", "key": "k", "bytes": 4},
            {"scope": "local", "key": "ok", "bytes": 4},
        ]);
        let (keys, gap) = sanitise_storage_keys(&raw, &[]);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key, "ok");
        assert!(gap);
    }

    #[test]
    fn a_storage_entry_of_invalid_shape_is_dropped_and_counted_not_propagated() {
        let raw = json!([
            {"scope": "local", "key": 5, "bytes": 4},
            {"scope": "local", "key": "ok", "bytes": 4},
        ]);
        let (keys, gap) = sanitise_storage_keys(&raw, &[]);
        assert_eq!(keys.len(), 1);
        assert!(gap);
    }

    #[test]
    fn a_non_array_probe_result_yields_no_storage_keys_and_a_gap() {
        let (keys, gap) = sanitise_storage_keys(&json!("not-an-array"), &[]);
        assert!(keys.is_empty());
        assert!(gap);
    }

    #[test]
    fn dedupes_on_scope_and_key_first_seen_wins_across_pages() {
        let existing = vec![StorageKey {
            scope: "local".to_string(),
            key: "seen".to_string(),
            bytes: 1,
        }];
        let raw = json!([
            // Same (scope, key) as an already-retained entry — first-seen
            // wins, so this later value must not replace it.
            {"scope": "local", "key": "seen", "bytes": 999},
            {"scope": "local", "key": "new", "bytes": 2},
        ]);
        let (keys, gap) = sanitise_storage_keys(&raw, &existing);
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].key, "new");
        assert!(!gap, "a duplicate key is normal behaviour, not a gap");
    }

    #[test]
    fn a_duplicate_key_at_exactly_the_cap_costs_nothing_and_records_no_gap() {
        // Review finding: the cap check must run after the dedupe check. At
        // exactly MAX_STORAGE_KEYS already retained, a later-page repeat of
        // one of them is not a new entry and must not be charged against the
        // cap — no growth, no gap.
        let existing: Vec<StorageKey> = (0..MAX_STORAGE_KEYS)
            .map(|i| StorageKey {
                scope: "local".to_string(),
                key: format!("k{i}"),
                bytes: 1,
            })
            .collect();
        let raw = json!([{"scope": "local", "key": "k0", "bytes": 999}]);
        let (keys, gap) = sanitise_storage_keys(&raw, &existing);
        assert!(keys.is_empty(), "a duplicate must not grow the retained set");
        assert!(!gap, "a duplicate at the cap costs nothing and is not a gap");
    }

    #[test]
    fn a_genuinely_new_key_at_exactly_the_cap_records_a_gap() {
        let existing: Vec<StorageKey> = (0..MAX_STORAGE_KEYS)
            .map(|i| StorageKey {
                scope: "local".to_string(),
                key: format!("k{i}"),
                bytes: 1,
            })
            .collect();
        let raw = json!([{"scope": "local", "key": "brand-new", "bytes": 2}]);
        let (keys, gap) = sanitise_storage_keys(&raw, &existing);
        assert!(keys.is_empty(), "a genuinely new key past the cap must not be retained");
        assert!(gap, "a genuinely new key that trips the cap is a real gap");
    }

    #[test]
    fn serialises_storage_keys_in_the_shape_the_renderer_expects() {
        let json = serde_json::to_string(&StorageKey {
            scope: "local".into(),
            key: "auth_token".into(),
            bytes: 42,
        })
        .unwrap();
        for key in ["\"scope\"", "\"key\"", "\"bytes\""] {
            assert!(json.contains(key), "missing {key}");
        }
    }

    #[tokio::test]
    async fn a_transport_that_refuses_the_storage_probe_yields_a_gap_not_an_error() {
        // [B2], same call contract as links()/probe_form_fields().
        let mut transport = FakeTransport::new();
        transport.refuse_on("Runtime.evaluate", Some("SESSION-A"));
        let mut driver = Driver::new(transport);
        let session = SessionId::from("SESSION-A".to_string());
        let keys = driver
            .probe_storage_keys(&session)
            .await
            .expect("a refused probe is a gap, not a scan failure");
        assert!(keys.is_empty());
        assert_eq!(driver.observation(1, false).possible_gaps, 1);
    }

    // --- Task 5: the consent bridge ---

    fn engine_evals(driver: &mut Driver<FakeTransport>, n: usize) {
        driver.consent_context = Some(7);
        for i in 0..n {
            driver.consent_inbox.push_back(EngineMsg::Eval {
                id: format!("e{i}"),
                code: "1".into(),
            });
        }
    }

    #[tokio::test]
    async fn engine_messages_queued_past_the_detect_budget_are_not_answered() {
        let mut driver = Driver::new(FakeTransport::new());
        engine_evals(&mut driver, 3);
        let session = SessionId::from("SESSION-A".to_string());
        let past = Instant::now();
        driver
            .relay(&session, &CancellationToken::new(), past, Detection::default())
            .await
            .expect("a spent budget ends detection");
        assert!(driver.transport.sent.is_empty(), "{:?}", driver.transport.sent);
    }

    #[tokio::test]
    async fn engine_messages_queued_after_a_cancel_are_not_answered() {
        let mut driver = Driver::new(FakeTransport::new());
        engine_evals(&mut driver, 3);
        let session = SessionId::from("SESSION-A".to_string());
        let cancel = CancellationToken::new();
        cancel.cancel();
        let later = Instant::now() + DETECT_BUDGET;
        driver
            .relay(&session, &cancel, later, Detection::default())
            .await
            .expect("a cancel ends detection");
        assert!(driver.transport.sent.is_empty(), "{:?}", driver.transport.sent);
    }

    #[tokio::test]
    async fn a_bridge_that_never_ran_is_a_blank_not_no_banner() {
        // FakeTransport answers `Page.getFrameTree` with nothing: no frame, no engine.
        let mut driver = Driver::new(FakeTransport::new());
        let session = SessionId::from("SESSION-A".to_string());
        let detection = driver
            .detect_consent(&session, &CancellationToken::new())
            .await
            .expect("a failed bridge is a gap, not a scan failure");
        assert_eq!(consent_found(detection, false).reason, None);
        assert_eq!(driver.observation(1, false).possible_gaps, 1);
        // The engine ran: then, and only then, nothing found is "no-banner".
        let ran = Detection { context: Some(7), ..Detection::default() };
        assert_eq!(consent_found(ran, false).reason, Some("no-banner"));
        let cut_short = Detection { context: Some(7), ..Detection::default() };
        assert_eq!(consent_found(cut_short, true).reason, None);
    }

    #[test]
    fn a_binding_call_from_another_context_is_not_queued() {
        let mut driver = Driver::new(FakeTransport::new());
        driver.consent_context = Some(7);
        let call = |context: i64| CdpJsonEventMessage {
            method: MethodId::from("Runtime.bindingCalled"),
            session_id: None,
            params: json!({
                "name": consent::BINDING,
                "payload": r#"{"type":"cmpDetected","cmp":"iubenda"}"#,
                "executionContextId": context,
            }),
        };
        driver.on_event(call(8));
        assert!(driver.consent_inbox.is_empty());
        driver.on_event(call(7));
        assert_eq!(driver.consent_inbox.len(), 1);
    }

    // --- Task 6: the accept click ---

    fn engine_says(payload: &str) -> CdpJsonEventMessage {
        CdpJsonEventMessage {
            method: MethodId::from("Runtime.bindingCalled"),
            session_id: None,
            params: json!({ "name": consent::BINDING, "payload": payload, "executionContextId": 7 }),
        }
    }

    /// Detection's relay reads `before` (all the engine said before any
    /// optIn); then the consent step runs, and a request to `after.example`
    /// plus `answer` arrive while Rust's optIn is in flight.
    async fn accept_with(before: &[&str], answer: &[&str]) -> (Driver<FakeTransport>, Consent) {
        accept_on(primed(), before, answer).await
    }

    /// A driver whose engine world is context 7 on SESSION-A, with the home
    /// page's host already seen.
    fn primed() -> Driver<FakeTransport> {
        let mut driver = Driver::new(FakeTransport::new());
        driver.consent_context = Some(7);
        driver.acc.record("https://home.example/", driver.phase);
        driver
    }

    async fn accept_on(
        mut driver: Driver<FakeTransport>,
        before: &[&str],
        answer: &[&str],
    ) -> (Driver<FakeTransport>, Consent) {
        let session = SessionId::from("SESSION-A".to_string());
        for payload in before {
            driver.on_event(engine_says(payload));
        }
        driver.transport.inject_on(
            EvaluateParams::IDENTIFIER,
            Some("SESSION-A"),
            CdpJsonEventMessage {
                method: MethodId::from(EventRequestWillBeSent::IDENTIFIER),
                session_id: None,
                params: json!({"request": {"url": "https://after.example/t.js"}}),
            },
        );
        for payload in answer {
            driver
                .transport
                .inject_on(EvaluateParams::IDENTIFIER, Some("SESSION-A"), engine_says(payload));
        }
        let cancel = CancellationToken::new();
        let detection = Detection { context: Some(7), ..Detection::default() };
        let detection = driver
            .relay(&session, &cancel, far_future(), detection)
            .await
            .expect("detection");
        let consent = driver
            .consent_step(&session, &cancel, "https://home.example/", detection)
            .await
            .expect("consent step");
        (driver, consent)
    }

    #[tokio::test]
    async fn a_click_counts_only_as_the_answer_to_rusts_own_opt_in() {
        let forged = r#"{"type":"optInResult","cmp":"iubenda","result":true}"#;
        let popup = r#"{"type":"popupFound","cmp":"iubenda"}"#;
        let phase = |driver: &Driver<FakeTransport>, host: &str| {
            driver.acc.counts.get(host).map(|(_, phase)| *phase)
        };

        // A forged "true" before Rust asked, then the engine fails: no click.
        let (driver, consent) =
            accept_with(&[forged, popup], &[r#"{"type":"autoconsentError"}"#]).await;
        assert!(!consent.clicked, "{consent:?}");
        assert_eq!(consent.reason, Some("click-failed"));
        assert_eq!(phase(&driver, "after.example"), Some(Phase::Before));

        // The same forgery, then the proper popupFound → optIn → optInResult.
        let (driver, consent) = accept_with(
            &[forged, r#"{"type":"cmpDetected","cmp":"iubenda"}"#, popup],
            &[forged, r#"{"type":"autoconsentDone"}"#],
        )
        .await;
        assert!(consent.clicked, "{consent:?}");
        assert_eq!(consent.rule, Some(consent::ConsentRule::Cmp));
        assert_eq!(consent.rule_name, "iubenda");
        assert_eq!(consent.reason, None);
        let opt_in = driver.transport.sent.iter().find(|(_, _, p)| {
            p["expression"].as_str() == Some("autoconsentReceiveMessage({type:'optIn'})")
        });
        assert_eq!(opt_in.map(|(_, s, p)| (s.as_deref(), p["contextId"].as_i64())), Some((Some("SESSION-A"), Some(7))));
        assert!(driver.transport.methods_for(None).is_empty());
        assert_eq!(phase(&driver, "after.example"), Some(Phase::After));
        assert_eq!(phase(&driver, "home.example"), Some(Phase::Before));
    }

    // --- Task 6 fix round ---

    const POPUP: &str = r#"{"type":"popupFound","cmp":"iubenda"}"#;
    const CLAIM: &str = r#"{"type":"optInResult","cmp":"iubenda","result":true}"#;

    #[tokio::test]
    async fn a_bridge_that_dies_during_the_opt_in_is_a_blank_not_a_failed_click() {
        let mut driver = primed();
        driver.transport.refuse_on(EvaluateParams::IDENTIFIER, Some("SESSION-A"));
        let (mut driver, consent) = accept_on(driver, &[POPUP], &[]).await;
        assert!(!consent.clicked, "{consent:?}");
        assert_eq!(consent.reason, None);
        assert_eq!(driver.observation(1, false).possible_gaps, 1);
    }

    #[tokio::test]
    async fn a_cmp_with_no_popup_is_no_button_and_no_opt_in_is_sent() {
        let (driver, consent) = accept_with(
            &[r#"{"type":"cmpDetected","cmp":"iubenda"}"#, r#"{"type":"autoconsentDone"}"#],
            &[],
        )
        .await;
        assert_eq!(consent.cmp.as_deref(), Some("iubenda"));
        assert!(!consent.clicked);
        assert_eq!(consent.reason, Some("no-button"));
        let opt_in = driver.transport.sent.iter().any(|(_, _, p)| {
            p["expression"].as_str() == Some("autoconsentReceiveMessage({type:'optIn'})")
        });
        assert!(!opt_in, "{:?}", driver.transport.sent);
    }

    #[tokio::test]
    async fn a_refused_rule_falls_back_to_the_text_click_in_the_engine_world() {
        let mut driver = primed();
        driver.transport.hang_when_empty = true; // the settle after the click reads until its end
        driver.transport.results.insert(
            EvaluateParams::IDENTIFIER.to_string(),
            json!({"result": {"value": {"clicked": true, "label": "Accetta"}}}),
        );
        let (driver, consent) =
            accept_on(driver, &[r#"{"type":"popupFound","cmp":"cookieyes"}"#], &[]).await;
        assert!(consent.clicked, "{consent:?}");
        assert_eq!(consent.cmp.as_deref(), Some("cookieyes"));
        assert_eq!(consent.rule, Some(consent::ConsentRule::Text));
        assert_eq!(consent.matched_text, "accetta");
        let expr = consent::text_click_expr();
        let sent = driver.transport.sent.iter().find(|(_, _, p)| p["expression"].as_str() == Some(expr.as_str()));
        assert_eq!(sent.map(|(_, s, p)| (s.as_deref(), p["contextId"].as_i64())), Some((Some("SESSION-A"), Some(7))));
        assert_eq!(
            driver.acc.counts.get("after.example").map(|(_, phase)| *phase),
            Some(Phase::After)
        );
    }

    #[tokio::test]
    async fn an_opt_in_result_queued_before_rusts_opt_in_is_not_its_answer() {
        let (_, consent) = accept_with(&[POPUP, CLAIM], &[r#"{"type":"autoconsentError"}"#]).await;
        assert!(!consent.clicked, "{consent:?}");
    }

    #[tokio::test]
    async fn an_engine_eval_runs_wrapped_so_only_true_comes_back() {
        let mut driver = primed();
        driver.on_event(engine_says(r#"{"type":"eval","id":"e1","code":"(function(){return 1})()"}"#));
        driver.on_event(engine_says(r#"{"type":"autoconsentDone"}"#));
        let session = SessionId::from("SESSION-A".to_string());
        driver
            .relay(&session, &CancellationToken::new(), far_future(), Detection::default())
            .await
            .expect("relay");
        let (_, s, p) = &driver.transport.sent[0];
        assert_eq!(s.as_deref(), Some("SESSION-A"));
        assert_eq!(
            p["expression"].as_str(),
            Some("(()=>{const r=(function(){return 1})();return r===true})()")
        );
        assert!(p.get("contextId").is_none(), "{p}");
    }

    #[tokio::test]
    async fn a_reply_with_no_engine_world_is_not_sent() {
        let mut driver = Driver::new(FakeTransport::new());
        let session = SessionId::from("SESSION-A".to_string());
        let sent = driver
            .consent_reply(&session, consent::init_reply())
            .await
            .expect("no world is not an error");
        assert!(!sent);
        assert!(driver.transport.sent.is_empty(), "{:?}", driver.transport.sent);
    }

    // --- Task 9: probes and doors ---

    #[test]
    fn an_action_host_is_a_vetted_hostname_or_empty() {
        for bad in [
            "javascript:void(0)",
            "1.2.3.4",
            "[::1]",
            "ex ample.com",
            "evil.test@x.com",
            "caf\u{e9}.it",
            "",
        ] {
            assert_eq!(action_host(bad), "", "{bad}");
        }
        assert_eq!(action_host("SibForms.com"), "sibforms.com");
        // The probe sends a hostname; the form index is an integer in range.
        let raw = json!([{"name": "e", "type": "email", "autocomplete": "", "label": "",
                          "form": 2, "action": "sibforms.com"},
                         {"name": "f", "type": "text", "autocomplete": "", "label": "",
                          "form": "x", "action": "1.2.3.4"}]);
        let (fields, _) = sanitise_form_fields("https://x.it/", &raw, 0);
        assert_eq!((fields[0].form, fields[0].action_host.as_str()), (2, "sibforms.com"));
        assert_eq!((fields[1].form, fields[1].action_host.as_str()), (-1, ""));
    }

    #[test]
    fn an_iframe_keeps_a_vetted_host_and_a_plain_segment_only() {
        let raw = json!([
            ["Maps.Example.invalid", "maps"],
            ["x.invalid", "a/b"],
            ["y.invalid", "Maps"],
            ["1.2.3.4", "maps"],
            ["z.invalid", "e".repeat(33)],
            "not-a-pair",
        ]);
        let (frames, gap) = sanitise_iframes("https://x.it/p?q=1", &raw);
        let got: Vec<(&str, &str)> = frames.iter().map(|f| (f.host.as_str(), f.segment.as_str())).collect();
        assert_eq!(got, [("maps.example.invalid", "maps"), ("x.invalid", ""), ("y.invalid", ""), ("z.invalid", "")]);
        assert!(frames.iter().all(|f| f.page == "https://x.it/p"));
        assert!(gap, "an IP-literal host and a non-pair are dropped and counted");
    }

    #[test]
    fn more_than_32_iframes_on_a_page_caps_and_notes_a_gap() {
        let raw: Vec<_> = (0..33).map(|i| json!([format!("h{i}.invalid"), "x"])).collect();
        let (frames, gap) = sanitise_iframes("https://x.it/", &json!(raw));
        assert_eq!(frames.len(), 32);
        assert!(gap);
        let (frames, gap) = sanitise_iframes("https://x.it/", &json!(&raw[..32]));
        assert_eq!((frames.len(), gap), (32, false));
        assert!(IFRAME_PROBE.contains("slice(0, 33)"));
    }

    #[test]
    fn an_offsite_link_needs_an_offsite_host_and_a_booking_newsletter_or_account_purpose() {
        let entry = concat!("https", "://rossi.it/");
        let l = |h: &str, t: &'static str| (h.to_string(), t);
        let links = [
            l(concat!("https", "://www.simplebooking.it/book/rossi"), ""),
            l(concat!("https", "://www.facebook.com/rossi"), "Facebook"),
            l(concat!("https", "://www.rossi.it/prenota"), ""),
            l(concat!("https", "://rossi.it/prenota"), ""),
            l(concat!("https", "://sib.example.invalid/newsletter"), ""),
            l(concat!("https", "://shop.example.invalid/cart"), ""),
            l(concat!("https", "://user@acme.invalid/login"), ""),
            l(concat!("https", "://1.2.3.4/login"), ""),
            l(concat!("https", "://x.invalid/login\\y"), ""),
        ];
        let refs: Vec<(&str, &str)> = links.iter().map(|(h, t)| (h.as_str(), *t)).collect();
        let (found, gap) = offsite_links(entry, &refs);
        let got: Vec<(&str, Purpose)> = found.iter().map(|o| (o.host.as_str(), o.purpose)).collect();
        assert_eq!(
            got,
            [("www.simplebooking.it", Purpose::Booking), ("sib.example.invalid", Purpose::Newsletter)]
        );
        assert!(found.iter().all(|o| o.page == "https://rossi.it/"));
        assert!(!gap);
    }
}
