# Adversarial audit of the plain-HTTP forwarding path

**Date:** 2026-08-02 (plan Task 5; the plan's filename date is 2026-08-01)
**Branch:** `v0.1-external-map`
**Auditor:** `security-auditor` agent, dispatched with the brief in Task 5 Step 6. Verdict: **PASS**,
with one important and two minor findings.

**Files audited, at the hashes they were audited at:**

| File | Blob hash at audit | Blob hash after this task |
|---|---|---|
| `src-tauri/src/proxy.rs` | `ec67d5e84ebf129b2222f0eebe705d037fef5d85` | `df09d609d24b5aa2e05c1c82c34f4086fafb628d` |
| `src-tauri/src/admission.rs` | `9f604625aadd8581c3d26055148f3723010f8cba` (unchanged since Task 10 of Phase 1) | `a98851fad699d86357312f7f9d1b300c28bd0a80` |

Audit-time tree tip was `f2d5ce5`. Rust suite before this task: 72. At audit time: 89.
After the findings were fixed: **96**.

This is new security code, audited as such, not as an extension of already-audited code. The
predecessor's four defects and their dispositions are in
`docs/decisions/2026-07-31-admission-audit.md`; that document's §1 mapping is unchanged by this
task. The auditor verified empirically with a probe, not by reading this repository's own report.

**What the auditor confirmed positively**, each by construction of an input rather than by reading:

- No input reaches a host `admission::decide` did not admit.
- There is exactly one `decide` call site and exactly one dial site in `proxy.rs`.
- The `CONNECT` and plain-HTTP paths never diverge in a direction where the plain path is wider.
- No smuggling construction puts a second request on one admission.
- The parser survived a long hostile-input table without a panic and without a false admission.

---

## 1. What the plain-HTTP path is allowed to do

Four restrictions, all deliberate, all load-bearing for the findings below.

1. **Absolute-form only.** `http://authority/…`. Origin-, authority- and asterisk-form are refused;
   `https://` in absolute form is refused rather than guessed at. The `Host:` header is never read
   by any code path in the file, so the request line and the header can never be played against
   each other.
2. **No request body.** A preamble carrying `Content-Length` or `Transfer-Encoding`, in any casing,
   once or twice, is refused before the decision. Request smuggling is closed structurally: there
   is no framing for this proxy and an origin server to disagree about.
3. **One request per connection.** The preamble is forwarded verbatim, the write half to the
   upstream is then shut, and only the response is relayed back. Nothing further is read from the
   client. This is what makes "a redirect cannot move the connection onto a host that was never
   admitted" a property of the code: the browser must open a new connection, which is a new
   decision.
4. **Method allowlist**, case-sensitive: `GET HEAD POST PUT PATCH DELETE OPTIONS`. `TRACE` excluded.

Restriction 2 has a functional cost worth stating in its own sentence: **a plain-HTTP request
carrying a body is refused, not forwarded.** It is refused loudly — a 403 and a ledger entry — not
silently.

---

## 2. Findings, severity and disposition

| # | Severity | Finding | Disposition |
|---|---|---|---|
| I1 | Important | A plain-HTTP target that was not in absolute form was handed to `decide` as the *host*, with port 0, and refused only because `admission::ALLOWED_PORTS` does not contain 0. The auditor's probe `GET rossi-editore.it HTTP/1.1` put a valid, in-scope host — one matching the scan origin exactly — into the decision, saved by a check in a different module. The recorded reason, `PortNotAllowed`, also misdescribed a request that named no port at all. | **Fixed** |
| M1 | Minor | A horizontal tab inside the authority was admitted and forwarded verbatim: `GET http://\trossi-editore.it/x` dialled `rossi-editore.it:80` and put the tab on the wire. `vet_host` opens with `str::trim`, and the request line splits on SP alone. Not egress — the socket went to the admitted host and the dialled string was the vetted one — but HT in a request target is illegal (RFC 9112 §3) and two parsers read it differently, which the module's own stated rule forbids. | **Fixed** |
| M2 | Minor | The ledger's host field can hold a request target, not a hostname: on the non-absolute-form path the whole target was recorded, so `GET /pay?iban=IT60X…&name=Rossi` was retained verbatim in a tuple field whose type and doc comments all call it a host. | **Recorded, not fixed** — see below. |

### I1 — how it was fixed

The non-absolute-form case now stops **before** the decision, in a `Request::Reject` variant that
records `(target, 0, DenyReason::MalformedAuthority)` locally and answers 403. This is not a second
admission check and cannot become one: the variant carries no port and no mode, so there is nothing
for a later edit to widen, and it has no allow branch. The single `decide` call site — the property
the original shape existed to protect — is preserved.

The cross-module invariant that remains is smaller and is now documented at the site that owns it
rather than only at the site that depends on it. `proxy.rs` can still produce port 0 from an
authority written literally as `:0`, so `admission.rs`'s `ALLOWED_PORTS` now carries a comment
naming `proxy.rs`'s plain-HTTP parser as a dependent, and `admission::never_admits_port_zero`
asserts both that the list excludes 0 and that `decide` refuses port 0 for an in-scope host.

Tests: `proxy::a_target_that_is_not_an_authority_never_reaches_the_admission_decision`,
`proxy::a_bare_in_scope_host_as_the_target_is_denied_and_named`,
`admission::never_admits_port_zero`.

### M1 — how it was fixed

HT is refused in the request line — it remains legal in a header value, and a test asserts that so
the rule is not vacuous — and, belt and braces, `parse_absolute_form` requires every byte of the
authority to be printable ASCII, so the property survives someone relaxing the preamble rule.
Test: `proxy::refuses_a_tab_inside_the_request_target`.

### M2 — recorded, deliberately not fixed

After the I1 fix the field still holds the request target as sent on that path — that is what the
`Reject` variant records, and recording less would mean recording nothing usable about a refused
request. It is capped at 253 bytes and reduced to printable ASCII by `redact_authority`, and the
ledger is in-memory with no consumer today.

**The requirement this leaves behind:** `Ledger::denied()`'s first element is *a host or a request
target*, not always a hostname, and it can contain a path and a query string that a page influenced.
Whatever renders the §9.3 egress report must not assume it is a hostname, and must not present it
as one. That is stated here because the type does not say it and the field name actively suggests
otherwise.

---

## 3. Hostile input: what was tried and what the code does

| Input | Outcome |
|---|---|
| Absolute-form to an in-scope host | Forwarded. `decide` → `Allow`; the dialled and recorded string is `Allow`'s host. |
| Absolute-form to an out-of-scope host | 403, deny `NotAScanTarget` on the **request-line** host. |
| Origin-form `GET /x`, authority-form `GET host:80`, asterisk-form `OPTIONS *` | 403, deny `MalformedAuthority`, recording the target. Never reaches `decide` (I1). |
| Bare in-scope host as the target (`GET rossi-editore.it`) | Same. This was the I1 probe. |
| `https://`, `ftp://` in absolute form | Refused; not guessed at. |
| `HTTP://` (uppercase scheme) | Accepted — a scheme is case-insensitive (RFC 3986 §3.1) and its spelling cannot change which host is named. |
| `Host:` disagreeing with the request line, in either direction | Request line decides. Tested with a positive control, so it cannot pass by refusing everything. |
| Duplicate, absent or empty `Host` | No effect: the header is never read. |
| Userinfo `user@host`, `host@evil`, `user@host@evil` | Refused. |
| `@` after a `?` or `#` delimiter | Query text, not userinfo; the authority is what precedes the delimiter, which is the reading RFC 3986 §3.2 and browsers give it. Still subject to the decision. |
| `?` and `#` as authority delimiters | Both end the authority exactly as `/` does; an in-scope name hidden in a query string does not become the host. |
| Percent-encoded authority (`%2e`, `%00`, `%2f`, `%72`) | Never decoded. `%` is outside `vet_host`'s allowlist → deny `MalformedAuthority`. |
| Port `:445` | Deny `PortNotAllowed`. `:99999`, `:+80`, `:8o`, `: 80`, `:`, `:80:443` → refused by the parser. `:0` → deny `PortNotAllowed`. |
| Mixed-case host, trailing dot | Admitted on the normalised form; the normalised string is dialled and recorded. |
| IPv4 literal (`127.0.0.1`, `169.254.169.254`, `8.8.8.8`) | Deny `IpLiteral`. |
| IPv6 in brackets, including a zone id | Refused by the parser before the decision → deny `MalformedAuthority`. Never dialled. |
| A name resolving to loopback, RFC 1918 or the metadata endpoint | Unchanged from Phase 1: refused by `is_permitted_upstream` in the connector (audit F2). |
| Oversized header block (1.5 MB) | Refused at the pre-existing 8 KB bound. The read never grows. |
| No CRLF at all | Refused at the pre-existing 10 s read timeout. |
| Bare CR or bare LF line endings | Refused: CR and LF may appear only as a pair. |
| HT in the request line | Refused (M1). HT in a header value is still accepted. |
| NUL, DEL, ESC, any control character, any non-ASCII byte in the preamble | Refused by the byte allowlist. |
| obs-fold continuation, including one hiding a `Content-Length` | Refused. |
| `Content-Length`, `Transfer-Encoding`, duplicated or conflicting, any casing | Refused before the decision. |
| Second request pipelined in the same segment as an admitted first | Whole connection refused; nothing forwarded. |
| Second request sent after the response on the same socket | Never read, never dialled, no new ledger entry. |
| Extra space in the request line; empty request line; missing version; `HTTP/2.0`; lowercase method | Refused. |

Every one of these reaches exactly one ledger outcome. `assert_sensor_alive` — the
`accepted == outcomes` reconciliation from Phase 1 finding F5 — is asserted at the end of every
socket-level test in the module, so a clean result from a dead observer fails rather than passes.

---

## 4. What this audit could not determine

Named as such, rather than left implied.

1. **Whether the early FIN produces a response from a real origin server could not be determined.**
   Every test and probe observes it against a loopback stand-in in the same file. The mechanism is
   confirmed — the FIN propagates and the reply returns — but not that nginx, Apache, IIS or a CDN
   edge behaves the same. A server treating a half-close as an aborted request would answer
   nothing, and the scan would render a blank page: a silent failure, which is this tool's worst
   mode.

2. **Whether refusing all request bodies is the right product decision.** It is a security
   decision made inside a security task, and it removes a capability: a plain-HTTP `POST`, `PUT` or
   `PATCH` will not be forwarded. The refusal is visible in the ledger rather than silent, and the
   alternative — forwarding bodies — reopens the framing disagreement that request smuggling is
   made of. Recorded so that whoever meets a broken plain-HTTP form knows this was chosen, not
   overlooked.

3. **The behaviour of the shipped release binary was not observed.** All 96 tests run under the dev
   profile with unwinding. `panic = "abort"` in `[profile.release]` means the join-based panic
   tripwire in `start` is dead code in every shipped artefact — Phase 1 finding F7, accepted there
   and unchanged here. The plain-HTTP path adds no `unwrap`, no `expect`, no indexing and no
   unchecked arithmetic, so the intended panic count is zero either way; that is verified by
   reading and by the hostile-input tests, not by a release build.

4. **Behaviour under concurrent load was not tested.** Every test drives one or a few connections
   in sequence. Nothing in the plain-HTTP path shares mutable state between connections — the
   ledger's counters are atomics and its records are behind a mutex, both from Phase 1 — but no
   test opens many connections at once, so the reasoning is by construction rather than by
   measurement.

Carried forward unchanged from the Phase 1 audit and *not* re-opened here: the scan lifecycle
(F6 — no idle timeout, no revocation, no stop handle; the response relay inherits this), the
unauthenticated loopback proxy (F11), the multi-label public suffix limitation (F10), and the
`file://` / non-proxy-protocol requirement carried to the browser launch flags (§1 of that
document).
