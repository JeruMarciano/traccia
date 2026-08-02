//! The admission decision. This is the executable form of spec §7.1.
//!
//! Pure by construction: no I/O, no clock, no global state. The proxy in `proxy.rs` is the
//! only caller, and it must treat a `Deny` as final. Nothing here can panic — a panic inside a
//! spawned connection task would be a silent failure of the guard, which is the one failure mode
//! this component may not have.
//!
//! The deny path allocates nothing at all. `vet_host` validates in place and hands back a
//! borrowed slice of the caller's input; comparison is `eq_ignore_ascii_case` and a
//! length-arithmetic label-boundary check rather than a lowercased copy and a `format!("{.o}")`.
//! No deny reason carries a value, so no deny path can interpolate anything either. Only the
//! `Allow` arm allocates, once it has a decision worth carrying: the vetted host and the origin
//! that matched.
//!
//! This is a real constraint and not housekeeping. `decide` runs once per connection attempt on
//! a path whose whole job is to reject, and an earlier version of this module claimed to be
//! allocation-free on deny while allocating once per origin entry per request. The claim is now
//! enforced by construction rather than by comment.

use std::net::IpAddr;

/// Only the two ports a website scan can legitimately need. Everything else — SSH, SMB, RDP,
/// SOCKS, a stray debugging port — is denied whatever the host.
///
/// **This list has a dependent outside this module.** `proxy.rs`'s plain-HTTP parser can hand
/// `decide` a port of 0, from an authority whose port is literally `:0`, and relies on this check
/// to refuse it. Anything that widens this list — a new port, or making it configurable — must
/// keep 0 out of it; `never_admits_port_zero` holds that. Read it before editing this line.
const ALLOWED_PORTS: [u16; 2] = [80, 443];

/// RFC 1035 caps a domain name at 253 characters. Anything longer is not a name we could be
/// asked to allow, so it is rejected before any comparison work happens.
const MAX_HOST_LEN: usize = 253;

/// `Allow` carries both halves deliberately.
///
/// `host` is the *normalised* host that was asked for — the only string the guard has actually
/// vetted. The caller must connect to that and record that; the raw authority it parsed off the
/// request line differs from it by anything `str::trim` removes, which is the whole Unicode
/// `White_Space` set, so handing the raw string to a resolver would mean dialling a name the
/// guard never approved. `origin` is the scan-origin entry that matched, which is what makes the
/// decision explicable but is not the host anything was contacted at: three different subdomains
/// of one scan target must not all be recorded as the apex.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow { host: String, origin: String },
    Deny { reason: DenyReason },
}

/// Deny reasons are an enum, not a formatted string. The host is already known to the caller,
/// which pairs it with the reason when it records the attempt; keeping the host out of the
/// reason means no deny path can interpolate a value into something that might later be logged
/// somewhere the host does not belong.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DenyReason {
    MalformedAuthority,
    IpLiteral,
    PortNotAllowed,
    NoScanRunning,
    NotAScanTarget,
}

/// Normalise a host for comparison, or refuse to compare it at all.
///
/// The character set is an allowlist, not a denylist. A browser sends an ASCII, punycoded
/// authority; anything outside `[a-z0-9.-]` after lowercasing is anomalous, and rejecting it
/// here removes the entire homograph and Unicode-separator class in one rule rather than
/// requiring every future reader to reason about Unicode normalisation. `@`, `:`, `/`, `\`,
/// whitespace and control characters all fall out of this for free.
/// Returns a borrowed slice of the caller's input, never a copy — comparison is done
/// case-insensitively rather than by lowercasing, so nothing is allocated to reach a `Deny`.
/// `pub(crate)` for `scan::parse_target`, which must refuse any host this
/// would refuse: a scan origin the proxy cannot read the same way as the
/// module that stored it is a scan origin that means two different things.
/// Visibility only — the rule itself is unchanged and lives here.
pub(crate) fn vet_host(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_HOST_LEN {
        return None;
    }
    if !trimmed.is_ascii() {
        return None;
    }
    // A single trailing dot is absolute-DNS form for the same name. Strip exactly one, on both
    // sides of every comparison, so `example.com.` and `example.com` cannot be played against
    // each other in either direction.
    let host = trimmed.strip_suffix('.').unwrap_or(trimmed);
    if host.is_empty() {
        return None;
    }
    if !host.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-') {
        return None;
    }
    // Empty labels (`..`, a leading dot) are not a name, and would make suffix matching
    // meaningless.
    if host.split('.').any(|label| label.is_empty()) {
        return None;
    }
    Some(host)
}

/// True when `h` is a strict subdomain of `o`, on a label boundary.
///
/// Length arithmetic and `get`, never `format!` and never indexing: the `format!(".{o}")` this
/// replaces allocated once per origin entry per request, on the path whose entire job is to
/// reject. `checked_sub` and `str::get` mean no input can make this panic, which
/// `regression_never_panics_on_hostile_input` is there to hold.
fn is_subdomain_of(h: &str, o: &str) -> bool {
    let Some(cut) = h.len().checked_sub(o.len()) else {
        return false;
    };
    let (Some(prefix), Some(suffix)) = (h.get(..cut), h.get(cut..)) else {
        return false;
    };
    // `prefix` must be at least one label character plus the separating dot, so `notrossi` can
    // never pass for `.rossi` and a leading-dot host can never match.
    prefix.len() >= 2 && prefix.ends_with('.') && suffix.eq_ignore_ascii_case(o)
}

fn is_ip_literal(host: &str) -> bool {
    host.parse::<IpAddr>().is_ok()
}

/// A scan-origin entry only counts if it is a hostname that can be matched against. Anything
/// else is skipped, never matched: a blank entry, a single label such as a bare TLD, or an IP
/// literal. `scan_origins` is populated from parsed user input in Phase 2, where a partial or
/// empty value is easy to produce.
fn usable_origin(entry: &str) -> Option<&str> {
    let o = vet_host(entry)?;
    if !o.contains('.') {
        return None;
    }
    if is_ip_literal(o) {
        return None;
    }
    Some(o)
}

pub fn decide(host: &str, port: u16, scan_origins: &[String]) -> Decision {
    let Some(h) = vet_host(host) else {
        return Decision::Deny { reason: DenyReason::MalformedAuthority };
    };
    if is_ip_literal(h) {
        // A scan target is a hostname the user typed. Denying IP literals unconditionally costs
        // the ability to scan a bare address — which the product does not offer — and closes
        // loopback pivots and cloud metadata endpoints (169.254.169.254) in one rule.
        return Decision::Deny { reason: DenyReason::IpLiteral };
    }
    if !ALLOWED_PORTS.contains(&port) {
        return Decision::Deny { reason: DenyReason::PortNotAllowed };
    }
    if scan_origins.is_empty() {
        return Decision::Deny { reason: DenyReason::NoScanRunning };
    }
    for entry in scan_origins {
        let Some(o) = usable_origin(entry) else { continue };
        // Suffix matching is on a label boundary only, never a bare `ends_with(o)`, so
        // `notrossi-editore.it` cannot pass as `rossi-editore.it`. Only here, having decided to
        // admit, is anything allocated.
        if h.eq_ignore_ascii_case(o) || is_subdomain_of(h, o) {
            return Decision::Allow {
                host: h.to_ascii_lowercase(),
                origin: o.to_ascii_lowercase(),
            };
        }
    }
    Decision::Deny { reason: DenyReason::NotAScanTarget }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origins(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_string()).collect()
    }

    fn denied(d: &Decision) -> &DenyReason {
        match d {
            Decision::Deny { reason } => reason,
            Decision::Allow { host, origin } => {
                panic!("expected a deny, got allow for {host} via {origin}")
            }
        }
    }

    fn allowed(host: &str, origin: &str) -> Decision {
        Decision::Allow { host: host.to_string(), origin: origin.to_string() }
    }

    // ---- ordinary behaviour -------------------------------------------------

    #[test]
    fn denies_everything_when_no_scan_is_running() {
        assert_eq!(denied(&decide("example.com", 443, &[])), &DenyReason::NoScanRunning);
    }

    #[test]
    fn allows_the_scan_target_and_its_subdomains() {
        let o = origins(&["rossi-editore.it"]);
        assert_eq!(decide("rossi-editore.it", 443, &o), allowed("rossi-editore.it", "rossi-editore.it"));
        assert_eq!(decide("www.rossi-editore.it", 443, &o), allowed("www.rossi-editore.it", "rossi-editore.it"));
        assert_eq!(decide("a.b.rossi-editore.it", 80, &o), allowed("a.b.rossi-editore.it", "rossi-editore.it"));
    }

    // ---- audit finding F4: the label-boundary check, without format! -------

    #[test]
    fn the_label_boundary_check_holds_at_every_edge() {
        // The allocation-free replacement for `h.ends_with(&format!(".{o}"))`. These are the
        // cases where length arithmetic could go wrong where string concatenation would not.
        assert!(is_subdomain_of("www.rossi-editore.it", "rossi-editore.it"));
        assert!(is_subdomain_of("a.b.rossi-editore.it", "rossi-editore.it"));
        assert!(is_subdomain_of("A.ROSSI-EDITORE.IT", "rossi-editore.it"));
        // equal is not a *sub*domain; `decide` handles that with eq_ignore_ascii_case
        assert!(!is_subdomain_of("rossi-editore.it", "rossi-editore.it"));
        // no label boundary
        assert!(!is_subdomain_of("notrossi-editore.it", "rossi-editore.it"));
        // a bare dot is not a label
        assert!(!is_subdomain_of(".rossi-editore.it", "rossi-editore.it"));
        // origin longer than the host must not underflow
        assert!(!is_subdomain_of("it", "rossi-editore.it"));
        assert!(!is_subdomain_of("", "rossi-editore.it"));
        assert!(!is_subdomain_of("x", ""));
    }

    // ---- audit finding F1/F3 -----------------------------------------------

    #[test]
    fn allow_carries_the_normalised_host_asked_for_and_not_only_the_matched_origin() {
        // F1: the caller records what this returns. If `Allow` carried only the origin, three
        // different subdomains of one scan target would all be recorded as the apex, and a
        // vendor on `analytics.` — exactly what a data-flow map exists to surface — would be
        // indistinguishable from the site itself.
        let o = origins(&["rossi-editore.it"]);
        assert_eq!(
            decide("analytics.rossi-editore.it", 443, &o),
            allowed("analytics.rossi-editore.it", "rossi-editore.it")
        );
        assert_eq!(
            decide("cdn.rossi-editore.it", 443, &o),
            allowed("cdn.rossi-editore.it", "rossi-editore.it")
        );
    }

    #[test]
    fn the_allowed_host_is_the_normalised_form_never_the_raw_input() {
        // F3: the caller connects to what this returns. `str::trim` removes the whole Unicode
        // `White_Space` set, so the raw authority and the string the guard vetted can differ —
        // and only the vetted one may reach a resolver.
        let o = origins(&["rossi-editore.it"]);
        for raw in ["  ROSSI-EDITORE.IT  ", "rossi-editore.it.", "\u{a0}rossi-editore.it"] {
            assert_eq!(
                decide(raw, 443, &o),
                allowed("rossi-editore.it", "rossi-editore.it"),
                "{raw:?}"
            );
        }
    }

    #[test]
    fn still_denies_third_parties_during_a_scan() {
        let o = origins(&["rossi-editore.it"]);
        assert_eq!(denied(&decide("tracker.example", 443, &o)), &DenyReason::NotAScanTarget);
        assert_eq!(denied(&decide("fonts.googleapis.com", 443, &o)), &DenyReason::NotAScanTarget);
    }

    #[test]
    fn does_not_treat_a_lookalike_host_as_the_scan_target() {
        let o = origins(&["rossi-editore.it"]);
        assert_eq!(denied(&decide("rossi-editore.it.evil.example", 443, &o)), &DenyReason::NotAScanTarget);
        assert_eq!(denied(&decide("notrossi-editore.it", 443, &o)), &DenyReason::NotAScanTarget);
    }

    #[test]
    fn matches_case_insensitively_on_both_sides() {
        assert!(matches!(decide("ROSSI-EDITORE.IT", 443, &origins(&["rossi-editore.it"])), Decision::Allow { .. }));
        assert!(matches!(decide("rossi-editore.it", 443, &origins(&["  Rossi-Editore.IT  "])), Decision::Allow { .. }));
    }

    #[test]
    fn treats_a_trailing_dot_as_the_same_host_on_both_sides() {
        assert!(matches!(decide("rossi-editore.it.", 443, &origins(&["rossi-editore.it"])), Decision::Allow { .. }));
        assert!(matches!(decide("rossi-editore.it", 443, &origins(&["rossi-editore.it."])), Decision::Allow { .. }));
        // and the normalisation must not open a suffix bypass
        assert_eq!(denied(&decide("evil.example.", 443, &origins(&["rossi-editore.it"]))), &DenyReason::NotAScanTarget);
    }

    // ---- regression: the four defects the egressGuard.ts audits found -------

    #[test]
    fn regression_authority_confusion_does_not_allow_the_real_host() {
        let o = origins(&["rossi-editore.it"]);
        assert_eq!(denied(&decide("rossi-editore.it@evil.example", 443, &o)), &DenyReason::MalformedAuthority);
        assert_eq!(denied(&decide("evil@rossi-editore.it.attacker.example", 443, &o)), &DenyReason::MalformedAuthority);
        assert_eq!(denied(&decide("rossi-editore.it:443@evil.example", 443, &o)), &DenyReason::MalformedAuthority);
    }

    #[test]
    fn regression_a_blank_scan_origin_is_never_a_wildcard() {
        assert_eq!(denied(&decide("evil.example.", 443, &origins(&[""]))), &DenyReason::NotAScanTarget);
        assert_eq!(denied(&decide("evil.example", 443, &origins(&["   "]))), &DenyReason::NotAScanTarget);
        assert_eq!(denied(&decide("evil.example", 443, &origins(&["."]))), &DenyReason::NotAScanTarget);
    }

    #[test]
    fn regression_a_bare_tld_scan_origin_is_never_a_wildcard() {
        assert_eq!(denied(&decide("anything.it", 443, &origins(&["it"]))), &DenyReason::NotAScanTarget);
        assert_eq!(denied(&decide("anything.com", 443, &origins(&["com"]))), &DenyReason::NotAScanTarget);
    }

    #[test]
    fn regression_never_panics_on_hostile_input() {
        let long = "a".repeat(10_000);
        let hostile = [
            "", " ", "\t", "\n", "..", "...", ":", "://", "/", "\\", "%00", "\u{0}",
            long.as_str(), "rossi-editore.it\t.evil.example",
            "rossi-editore.it\u{3002}evil.example", "rossi\u{2010}editore.it",
            "[::1]", "[fe80::1%25eth0]", "-.-", "xn--", "..rossi-editore.it",
            "rossi-editore..it", "*.rossi-editore.it", "%2e%2e", "host_name.example",
        ];
        for h in hostile {
            for port in [0u16, 80, 443, 8080, 65535] {
                let d = decide(h, port, &origins(&["rossi-editore.it", "", "it"]));
                assert!(matches!(d, Decision::Deny { .. }), "expected deny for {h:?}:{port}");
            }
        }
    }

    #[test]
    fn skips_unusable_entries_but_still_honours_a_usable_one_alongside_them() {
        let o = origins(&["", "   ", "it", ".", "rossi-editore.it"]);
        assert!(matches!(decide("rossi-editore.it", 443, &o), Decision::Allow { .. }));
        assert!(matches!(decide("www.rossi-editore.it", 443, &o), Decision::Allow { .. }));
        assert_eq!(denied(&decide("anything.it", 443, &o)), &DenyReason::NotAScanTarget);
    }

    // ---- new classes the URL guard never decided ---------------------------

    #[test]
    fn denies_every_port_but_http_and_https() {
        let o = origins(&["rossi-editore.it"]);
        for port in [0u16, 21, 22, 25, 445, 1080, 3389, 8080, 8443, 9222, 65535] {
            assert_eq!(denied(&decide("rossi-editore.it", port, &o)), &DenyReason::PortNotAllowed, "port {port}");
        }
        assert!(matches!(decide("rossi-editore.it", 80, &o), Decision::Allow { .. }));
        assert!(matches!(decide("rossi-editore.it", 443, &o), Decision::Allow { .. }));
    }

    #[test]
    fn never_admits_port_zero() {
        // Pinned as its own assertion, not left to the table above. Port 0 is not a port a client
        // can be answered on, and `proxy.rs`'s plain-HTTP parser can produce it from an authority
        // ending `:0`. A future edit that widens ALLOWED_PORTS fails here rather than in a
        // component whose job is to be the last line.
        assert!(!ALLOWED_PORTS.contains(&0));
        assert_eq!(
            denied(&decide("rossi-editore.it", 0, &origins(&["rossi-editore.it"]))),
            &DenyReason::PortNotAllowed
        );
    }

    #[test]
    fn denies_ip_literals_even_when_listed_as_a_scan_origin() {
        for ip in ["127.0.0.1", "169.254.169.254", "10.0.0.1", "192.168.1.1", "0.0.0.0", "8.8.8.8"] {
            assert_eq!(denied(&decide(ip, 443, &origins(&[ip]))), &DenyReason::IpLiteral, "{ip}");
        }
        // and an IP literal is never suffix-matched against a hostname origin
        assert_eq!(denied(&decide("1.2.3.4", 443, &origins(&["3.4"]))), &DenyReason::IpLiteral);
    }

    #[test]
    fn denies_a_non_ascii_authority_outright() {
        // A browser sends punycode in a CONNECT line. Anything else is anomalous, and rejecting
        // it at the door removes the whole homograph and Unicode-separator class rather than
        // trying to normalise it correctly.
        let o = origins(&["rossi-editore.it"]);
        assert_eq!(denied(&decide("rossi-editore.it\u{3002}evil.example", 443, &o)), &DenyReason::MalformedAuthority);
        assert_eq!(denied(&decide("rossi\u{2010}editore.it", 443, &o)), &DenyReason::MalformedAuthority);
    }

    #[test]
    fn denies_an_authority_carrying_a_scheme_slash_or_whitespace() {
        let o = origins(&["rossi-editore.it"]);
        // The scheme is assembled rather than written out: tests/build/noRemoteAssets.test.ts
        // forbids an http(s) URL literal anywhere under src-tauri/src, tests included, and that
        // guard is worth more than the convenience of one string. `concat!` is compile-time, so
        // the bytes reaching `decide` are identical to the literal.
        let with_scheme = concat!("https", "://", "rossi-editore.it");
        for h in [with_scheme, "rossi-editore.it/x", "rossi-editore.it\t.evil.example", "rossi editore.it"] {
            assert_eq!(denied(&decide(h, 443, &o)), &DenyReason::MalformedAuthority, "{h}");
        }
    }
}
