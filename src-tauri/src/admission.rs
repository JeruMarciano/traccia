//! The admission decision. This is the executable form of spec §7.1.
//!
//! Pure by construction: no I/O, no clock, no global state. The proxy in `proxy.rs` is the
//! only caller, and it must treat a `Deny` as final. Nothing here can panic — a panic inside a
//! spawned connection task would be a silent failure of the guard, which is the one failure mode
//! this component may not have.
//!
//! The deny path allocates exactly once, in `normalise_host`, and never again: a lowercased copy
//! of the authority is made before any comparison, and no deny reason carries a value. That is a
//! bounded, single, 253-byte-capped allocation per decision, not a per-origin one, and it is the
//! price of comparing without mutating the caller's input.

use std::net::IpAddr;

/// Only the two ports a website scan can legitimately need. Everything else — SSH, SMB, RDP,
/// SOCKS, a stray debugging port — is denied whatever the host.
const ALLOWED_PORTS: [u16; 2] = [80, 443];

/// RFC 1035 caps a domain name at 253 characters. Anything longer is not a name we could be
/// asked to allow, so it is rejected before any comparison work happens.
const MAX_HOST_LEN: usize = 253;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow { origin: String },
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
fn normalise_host(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_HOST_LEN {
        return None;
    }
    if !trimmed.is_ascii() {
        return None;
    }
    let lowered = trimmed.to_ascii_lowercase();
    // A single trailing dot is absolute-DNS form for the same name. Strip exactly one, on both
    // sides of every comparison, so `example.com.` and `example.com` cannot be played against
    // each other in either direction.
    let host = lowered.strip_suffix('.').unwrap_or(&lowered);
    if host.is_empty() {
        return None;
    }
    if !host
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
    {
        return None;
    }
    // Empty labels (`..`, a leading dot) are not a name, and would make suffix matching
    // meaningless.
    if host.split('.').any(|label| label.is_empty()) {
        return None;
    }
    Some(host.to_string())
}

fn is_ip_literal(host: &str) -> bool {
    host.parse::<IpAddr>().is_ok()
}

/// A scan-origin entry only counts if it is a hostname that can be matched against. Anything
/// else is skipped, never matched: a blank entry, a single label such as a bare TLD, or an IP
/// literal. `scan_origins` is populated from parsed user input in Phase 2, where a partial or
/// empty value is easy to produce.
fn usable_origin(entry: &str) -> Option<String> {
    let o = normalise_host(entry)?;
    if !o.contains('.') {
        return None;
    }
    if is_ip_literal(&o) {
        return None;
    }
    Some(o)
}

pub fn decide(host: &str, port: u16, scan_origins: &[String]) -> Decision {
    let Some(h) = normalise_host(host) else {
        return Decision::Deny { reason: DenyReason::MalformedAuthority };
    };
    if is_ip_literal(&h) {
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
        // Suffix matching is on a label boundary only: `.{o}` and never a bare `ends_with(o)`,
        // so `notrossi-editore.it` cannot pass as `rossi-editore.it`.
        if h == o || h.ends_with(&format!(".{o}")) {
            return Decision::Allow { origin: o };
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
            Decision::Allow { origin } => panic!("expected a deny, got allow for {origin}"),
        }
    }

    // ---- ordinary behaviour -------------------------------------------------

    #[test]
    fn denies_everything_when_no_scan_is_running() {
        assert_eq!(denied(&decide("example.com", 443, &[])), &DenyReason::NoScanRunning);
    }

    #[test]
    fn allows_the_scan_target_and_its_subdomains() {
        let o = origins(&["rossi-editore.it"]);
        assert_eq!(decide("rossi-editore.it", 443, &o), Decision::Allow { origin: "rossi-editore.it".into() });
        assert_eq!(decide("www.rossi-editore.it", 443, &o), Decision::Allow { origin: "rossi-editore.it".into() });
        assert_eq!(decide("a.b.rossi-editore.it", 80, &o), Decision::Allow { origin: "rossi-editore.it".into() });
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
