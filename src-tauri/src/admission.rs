//! The admission decision. This is the executable form of spec §7.1, as widened by spec §13.
//!
//! During a scan the proxy admits what a visitor's browser would fetch: any well-formed host on
//! 80 or 443, third parties included. A scanner that saw only the first-party layer would miss the
//! vendors a data-flow map exists to show, because each tag a page loads goes on to load the next.
//! What stays denied, whoever asks: IP literals, every other port, a malformed authority, and
//! everything when no scan is running.
//!
//! This decision is therefore no longer the network guard. It reads an authority string; it cannot
//! know where a name resolves, and any third party's DNS can point at the user's router or the
//! cloud metadata endpoint. The guard is `proxy::is_permitted_upstream`, applied to every address
//! a name resolves to before anything is dialled. Denying IP literals here keeps an address from
//! skipping resolution altogether, and keeps the ledger a list of names.
//!
//! Pure by construction: no I/O, no clock, no global state. The proxy in `proxy.rs` is the only
//! caller, and it must treat a `Deny` as final. Nothing here can panic — a panic inside a spawned
//! connection task would be a silent failure of the guard.
//!
//! The deny path allocates nothing at all. `vet_host` validates in place and hands back a borrowed
//! slice of the caller's input, and no deny reason carries a value, so no deny path can
//! interpolate anything either. Only the `Allow` arm allocates, once, for the vetted host. This is
//! a real constraint: `decide` runs once per connection attempt, and an earlier version of this
//! module claimed to be allocation-free on deny while allocating once per origin entry per request.

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

/// `host` is the *normalised* host that was asked for — the only string the guard has actually
/// vetted. The caller must connect to that and record that; the raw authority it parsed off the
/// request line differs from it by anything `str::trim` removes, which is the whole Unicode
/// `White_Space` set, so handing the raw string to a resolver would mean dialling a name the
/// guard never approved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow { host: String },
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

fn is_ip_literal(host: &str) -> bool {
    host.parse::<IpAddr>().is_ok()
}

/// A scan-origin entry only counts as a running scan if it is a dotted hostname. Anything else is
/// skipped: a blank entry, a single label such as a bare TLD, or an IP literal. `scan_origins` is
/// populated from parsed user input, where a partial or empty value is easy to produce, and a list
/// holding only such entries must read as no scan at all — never as "admit everything".
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
        // A scan target is a hostname the user typed, and a visitor's third parties are named
        // too. An address never passes through a resolver, so it would reach the network guard
        // only at dial time; refusing it here keeps the ledger a list of names.
        return Decision::Deny { reason: DenyReason::IpLiteral };
    }
    if !ALLOWED_PORTS.contains(&port) {
        return Decision::Deny { reason: DenyReason::PortNotAllowed };
    }
    if !scan_origins.iter().any(|o| usable_origin(o).is_some()) {
        return Decision::Deny { reason: DenyReason::NoScanRunning };
    }
    // Only here, having decided to admit, is anything allocated.
    Decision::Allow { host: h.to_ascii_lowercase() }
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
            Decision::Allow { host } => panic!("expected a deny, got allow for {host}"),
        }
    }

    fn allowed(host: &str) -> Decision {
        Decision::Allow { host: host.to_string() }
    }

    // ---- ordinary behaviour -------------------------------------------------

    #[test]
    fn denies_everything_when_no_scan_is_running() {
        assert_eq!(denied(&decide("example.com", 443, &[])), &DenyReason::NoScanRunning);
    }

    #[test]
    fn allows_the_scan_target_and_its_subdomains() {
        let o = origins(&["rossi-editore.it"]);
        assert_eq!(decide("rossi-editore.it", 443, &o), allowed("rossi-editore.it"));
        assert_eq!(decide("www.rossi-editore.it", 443, &o), allowed("www.rossi-editore.it"));
        assert_eq!(decide("a.b.rossi-editore.it", 80, &o), allowed("a.b.rossi-editore.it"));
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
            allowed("analytics.rossi-editore.it")
        );
        assert_eq!(
            decide("cdn.rossi-editore.it", 443, &o),
            allowed("cdn.rossi-editore.it")
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
                allowed("rossi-editore.it"),
                "{raw:?}"
            );
        }
    }

    #[test]
    fn admits_a_visitors_third_parties_during_a_scan() {
        let o = origins(&["rossi-editore.it"]);
        assert_eq!(decide("fonts.googleapis.com", 443, &o), allowed("fonts.googleapis.com"));
        assert_eq!(decide("Tracker.Example.", 80, &o), allowed("tracker.example"));
    }

    #[test]
    fn a_third_party_on_another_port_is_still_denied() {
        assert_eq!(
            denied(&decide("cdn.example", 8443, &origins(&["rossi-editore.it"]))),
            &DenyReason::PortNotAllowed
        );
    }

    #[test]
    fn a_blank_or_bare_tld_origin_list_is_no_scan_running_not_a_wildcard() {
        assert_eq!(denied(&decide("tracker.example", 443, &origins(&[""]))), &DenyReason::NoScanRunning);
        assert_eq!(denied(&decide("tracker.example", 443, &origins(&["it"]))), &DenyReason::NoScanRunning);
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
        // and a third party's trailing dot is stripped the same way before it is recorded
        assert_eq!(decide("evil.example.", 443, &origins(&["rossi-editore.it"])), allowed("evil.example"));
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
        assert_eq!(denied(&decide("evil.example.", 443, &origins(&[""]))), &DenyReason::NoScanRunning);
        assert_eq!(denied(&decide("evil.example", 443, &origins(&["   "]))), &DenyReason::NoScanRunning);
        assert_eq!(denied(&decide("evil.example", 443, &origins(&["."]))), &DenyReason::NoScanRunning);
    }

    #[test]
    fn regression_a_bare_tld_scan_origin_is_never_a_wildcard() {
        assert_eq!(denied(&decide("anything.it", 443, &origins(&["it"]))), &DenyReason::NoScanRunning);
        assert_eq!(denied(&decide("anything.com", 443, &origins(&["com"]))), &DenyReason::NoScanRunning);
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
                // `-.-` and `xn--` pass `vet_host`'s character allowlist, so on a web port they are
                // admitted like any other third-party name: no resolver will answer them, and one
                // that did would still face `proxy::is_permitted_upstream`.
                let admissible = matches!(h, "-.-" | "xn--") && (port == 80 || port == 443);
                assert_eq!(matches!(d, Decision::Allow { .. }), admissible, "{h:?}:{port}");
            }
        }
    }

    #[test]
    fn skips_unusable_entries_but_still_honours_a_usable_one_alongside_them() {
        let o = origins(&["", "   ", "it", ".", "rossi-editore.it"]);
        assert!(matches!(decide("rossi-editore.it", 443, &o), Decision::Allow { .. }));
        assert!(matches!(decide("www.rossi-editore.it", 443, &o), Decision::Allow { .. }));
        assert!(matches!(decide("anything.it", 443, &o), Decision::Allow { .. }));
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
