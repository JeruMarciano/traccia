# Adversarial audit of the admission decision

**Date:** 2026-08-01 (plan Task 10; the plan's filename date is 2026-07-31)
**Branch:** `tauri-port`
**Auditor:** `security-auditor` agent, dispatched with the brief in Task 10 Step 1. Verdict: **BLOCK**.

**Files audited, at the hashes they were audited at:**

| File | Blob hash at audit | Blob hash after this task |
|---|---|---|
| `src-tauri/src/admission.rs` | `3e04bd08863038603e077dae88d8b6df139c7c75` | `9f604625aadd8581c3d26055148f3723010f8cba` |
| `src-tauri/src/proxy.rs` | `f0d664b1622f49ff30df4eeec5105e490179c5aa` | `ae3fb3ac8f6cda08addf85f976fbd94622133e12` |

Audit-time tree tip was `a73ccd0`. Rust suite at audit time: 52 tests. After this task: **67**.

The auditor verified its findings empirically with a probe crate depending on `traccia` as a path
dependency, outside the repository. Every finding below that is marked *fixed* had its test
confirmed to fail against the pre-fix code before the fix landed; the commit message for each
says so.

**Nothing found here permitted egress today.** `scan_origins` is empty for the whole of this plan,
the proxy is not yet routed to anything, and `decide` therefore returns `NoScanRunning` for
everything. Every finding is about the guard being wrong for Phase 2, when it becomes
load-bearing. That is the right time to fix them and the wrong time to discover them.

---

## 1. The four `egressGuard.ts` defects, mapped

Task 3's table is the starting point. The audit **corrects it in one row**: the mapping the plan
proposed for the `file://` defect does not hold.

| Defect found in `egressGuard.ts` | Its shape at the proxy | Test here | Result |
|---|---|---|---|
| Blank-origin wildcard — `host.endsWith('.' + '')` matched any absolute-DNS host | An empty or whitespace scan-origin entry | `admission::regression_a_blank_scan_origin_is_never_a_wildcard` | **Covered.** Asserts `""`, `"   "` and `"."`. The first case (`evil.example.` against `[""]`) reproduces the original mechanism exactly. Structurally closed in `usable_origin`. |
| Bare-TLD wildcard — origin `it` allowed everything under `.it` | Same | `admission::regression_a_bare_tld_scan_origin_is_never_a_wildcard` | **Covered.** `"it"` and `"com"`. Structurally closed by the `!o.contains('.')` check. See the accepted limitation in §3 (F10). |
| Threw on malformed input, where a throw is not automatically a deny | Panics on malformed input, where a panic in a spawned task is silent | `admission::regression_never_panics_on_hostile_input`, plus `proxy::refuses_a_request_line_that_is_not_valid_utf8` and `proxy::refuses_an_oversized_header_block_instead_of_reading_forever` | **Covered, and strengthened.** 24 hostile authorities × 5 ports, asserting `Deny` rather than merely absence of panic. The fail-closed degradation on a poisoned `scan_origins` mutex (`proxy.rs`) is the counterpart of the TS `installEgressGuard` try/catch. |
| Remote `file://` authority permitted — `file://host/share/x` becomes a UNC path and an SMB connection | **The plan proposed: userinfo in front of the real host.** The audit rejects that mapping. | `admission::regression_authority_confusion_does_not_allow_the_real_host` exists and passes, but it tests a *different* class | **NOT covered, and cannot be.** See below. |

### The `file://` row, corrected

The plan mapped this defect onto authority confusion (`rossi-editore.it@evil.example`). That test
exists, passes, and is worth having — but it is not this defect. The two are different classes,
and treating one as the other would have retired the `file:` cases on a false equivalence.

The actual successor is nothing at all, because **an HTTP CONNECT proxy structurally cannot see
SMB**. A UNC fetch to `\\host\share\x` never produces a CONNECT and never reaches `handle()`. So
does the port check (`denies_every_port_but_http_and_https` includes 445) or the method check
(`denies_every_method_that_is_not_connect`) close it? No — they only close it *for traffic that
comes through the proxy*, and this traffic would not.

The defect's successor lives in Phase 2's browser launch flags and in the webview's own asset
loading, neither of which exists yet. It is therefore **carried forward as a Phase 2 requirement,
not retired**:

> **Carried forward to Phase 2.** The browser Traccia drives must be prevented from issuing
> `file://` requests with a remote authority, and from any protocol the proxy cannot see (SMB,
> mDNS, UDP/QUIC). The proxy is not, and cannot be, the enforcement point for those. Whatever
> mechanism Phase 2 uses must carry its own test.

The specification for that test is reproduced below rather than referenced. It previously lived in
`tests/main/egressGuard.test.ts`, which Task 12 deletes; a requirement that points at a deleted
file is a requirement that quietly stops existing. These are the original assertions, verbatim:

```ts
// MUST DENY — the defect itself (retirement-table #15, #16, and #30 at the guard layer).
decideEgress('file://attacker.example/share/x.png', [])                    // allow === false
decideEgress('file://rossi-editore.it/share/x.png', ['rossi-editore.it'])  // allow === false
//   ^ denied even though the authority *is* the scan target: a remote file authority
//     is an SMB fetch, not a fetch of the thing the user asked to scan.

// MUST STILL ALLOW — the paired control (#17, #18).
// Without these a Phase 2 mechanism could pass by blocking everything and breaking the app.
decideEgress('file:///app/index.html', [])              // allow === true
decideEgress('file://localhost/app/index.html', [])     // allow === true
decideEgress('devtools://devtools/bundled/x.js', [])    // allow === true
decideEgress('data:text/css,body{}', [])                // allow === true
decideEgress('blob:https://evil.example/uuid', [])      // allow === true
decideEgress('chrome-extension://abc/x.js', [])         // allow === true
```

The deny cases are the requirement; the allow cases are what stops the requirement being met
trivially. A Phase 2 implementation satisfies this only if it reproduces both halves.

---

## 2. Retirement table for `tests/main/egressGuard.test.ts`

31 `it(...)` across six `describe` blocks, counted on the branch point and confirmed
(`grep -c "  it("` → 31). This table is what makes it safe to delete that file in Task 12.

A proxy sees an **authority** — a host and a port off a CONNECT request line. It never sees a
scheme, a path, a query, or a URL at all. Every "does not apply" below reduces to that.

### `describe('decideEgress')` — 7

| # | `it(...)` | Disposition |
|---|---|---|
| 1 | allows local app resources | **Does not apply.** `file:` and `devtools:` are schemes. Local app resources are loaded by the webview from the bundle and never traverse the proxy. |
| 2 | blocks a font CDN even though it looks harmless | Carried by `admission::still_denies_third_parties_during_a_scan` (asserts `fonts.googleapis.com`) and `proxy::denies_a_third_party_while_a_scan_is_running`. |
| 3 | blocks any remote host when no scan is running | Carried by `admission::denies_everything_when_no_scan_is_running` and `proxy::denies_connect_when_no_scan_is_running`. |
| 4 | allows the scan target and its subdomains while a scan runs | Carried by `admission::allows_the_scan_target_and_its_subdomains` and `proxy::tunnels_connect_to_the_scan_target`. |
| 5 | still blocks third parties during a scan | Carried by `admission::still_denies_third_parties_during_a_scan`. |
| 6 | does not treat a lookalike host as the scan target | Carried by `admission::does_not_treat_a_lookalike_host_as_the_scan_target`, and reinforced by `admission::the_label_boundary_check_holds_at_every_edge`. |
| 7 | blocks a malformed url rather than letting it through | Carried by `admission::regression_never_panics_on_hostile_input` and `proxy::denies_every_method_that_is_not_connect`. |

### `describe('decideEgress — bypass attempts')` — 7

| # | `it(...)` | Disposition |
|---|---|---|
| 8 | not fooled by the scan target as userinfo in front of an attacker host | Carried by `admission::regression_authority_confusion_does_not_allow_the_real_host` (`rossi-editore.it@evil.example`, `rossi-editore.it:443@evil.example`). `@` is outside the character allowlist. |
| 9 | not fooled by an attacker host with the scan target as a userinfo-adjacent prefix | Same test (`evil@rossi-editore.it.attacker.example`). |
| 10 | not fooled by a Unicode dot look-alike | Carried by `admission::denies_a_non_ascii_authority_outright` (U+3002) and by case 15 of `regression_never_panics_on_hostile_input`. |
| 11 | not fooled by a tab injected into the host component | Carried by `admission::denies_an_authority_carrying_a_scheme_slash_or_whitespace`. Note the class differs: the WHATWG parser *stripped* the tab, whereas here it is rejected. |
| 12 | does not let a Unicode-hyphen homograph match | Carried by `admission::denies_a_non_ascii_authority_outright` (U+2010). |
| 13 | does not allowlist an IPv6 literal by falling through to a default-allow | Carried by `admission::denies_ip_literals_even_when_listed_as_a_scan_origin`, and by `[::1]` / `[fe80::1%25eth0]` in the hostile table. Bracketed IPv6 is additionally rejected by `parse_connect_authority`'s right-split on `:`. |
| 14 | treats the scan origin case-insensitively regardless of URL casing | Carried by `admission::matches_case_insensitively_on_both_sides` and `admission::the_allowed_host_is_the_normalised_form_never_the_raw_input`. |

### `describe('decideEgress — file: authority')` — 4

| # | `it(...)` | Disposition |
|---|---|---|
| 15 | blocks a file url pointing at a remote authority | **Does not apply at a proxy — carried forward to Phase 2** (§1). |
| 16 | blocks a remote file authority even when it is the scan target | **Does not apply at a proxy — carried forward to Phase 2** (§1). |
| 17 | still allows hostless and localhost file urls | **Does not apply.** No scheme reaches the proxy; bundle loading does not traverse it. |
| 18 | leaves the other local schemes alone (`devtools:`, `data:`, `blob:`, `chrome-extension:`) | **Does not apply.** All four are schemes with no authority a proxy could ever be asked about. |

### `describe('decideEgress — unusable scan origins')` — 7

| # | `it(...)` | Disposition |
|---|---|---|
| 19 | blank origin must not match a host with a trailing dot | Carried by `admission::regression_a_blank_scan_origin_is_never_a_wildcard`, first case. |
| 20 | blank origin must not match a url with an empty hostname | **Partially applies.** `about:blank` has no proxy equivalent — an empty authority never produces a CONNECT. The residue (an empty *host*) is covered: `""` is in the hostile table and denies as `MalformedAuthority`. |
| 21 | whitespace-only origin must not match | Carried by `admission::regression_a_blank_scan_origin_is_never_a_wildcard`, second case. |
| 22 | bare TLD origin must not allow everything under it | Carried by `admission::regression_a_bare_tld_scan_origin_is_never_a_wildcard`. |
| 23 | ignores origins carrying a scheme or a port separator | Carried by `admission::skips_unusable_entries_but_still_honours_a_usable_one_alongside_them` for the skipping behaviour; `/` and `:` are outside `vet_host`'s allowlist, exercised through `denies_an_authority_carrying_a_scheme_slash_or_whitespace`. |
| 24 | skips unusable entries but still honours a usable one alongside them | Carried by the identically named `admission::skips_unusable_entries_but_still_honours_a_usable_one_alongside_them`. |
| 25 | accepts a usable origin that needs trimming and lowercasing | Carried by `admission::matches_case_insensitively_on_both_sides`, second assertion (`"  Rossi-Editore.IT  "`). |

### `describe('decideEgress — malformed scanOrigins argument')` — 2

| # | `it(...)` | Disposition |
|---|---|---|
| 26 | blocks, without throwing, when `scanOrigins` is not an array | **Does not apply.** The signature is `&[String]`. A non-array cannot be constructed; the type system carries what the test carried. |
| 27 | blocks, without throwing, when an entry is not a string | **Does not apply**, same reason. The residue — an entry that is a string but unusable — is #19, #21, #22, #24. |

### `describe('installEgressGuard')` — 4

| # | `it(...)` | Disposition |
|---|---|---|
| 28 | cancels a request the decision rejects | Carried by `proxy::denies_a_third_party_while_a_scan_is_running`, which asserts the 403 *and* carries a positive control proving the allow path was awake at the same time. |
| 29 | lets a file url through | **Does not apply** (#17). |
| 30 | cancels a file url aimed at a remote authority | **Does not apply at a proxy — carried forward to Phase 2** (§1). |
| 31 | fails closed, and still calls back, if `getScanOrigins` throws | Carried structurally: `scan_origins.lock().map(...).unwrap_or_default()` degrades a poisoned mutex to an empty list, which `decide` treats as `NoScanRunning` — deny everything. Exercised end-to-end by `proxy::denies_connect_when_no_scan_is_running`. **Not covered by a test that poisons the mutex**; see §4. |

**Summary: 17 carried forward by a named Rust test, 1 partially carried, 13 do not apply at a
proxy — of which 3 are carried forward to Phase 2 as a requirement rather than retired.**

---

## 3. Findings, severity and disposition

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | High | The ledger recorded `Decision::Allow`'s `origin` — the scan-origin entry that matched — not the host contacted. Three CONNECTs to `www.`, `analytics.` and the apex all recorded as the apex. | **Fixed** — `0ead8ed` |
| F2 | High | `decide` denies IP *literals*; the connector resolves a *name*. A scan target's owner controls its DNS, so `internal.rossi-editore.it` → `127.0.0.1` or `169.254.169.254` was admitted and dialled. | **Fixed** — `f959c6f` |
| F3 | Medium | The raw authority off the request line was handed to the connector, while `decide` vetted a trimmed copy. `"\u{a0}rossi-editore.it"` was approved and the resolver got the leading NBSP. | **Fixed** — `0ead8ed` |
| F4 | Medium | The "deny path allocates exactly once" claim was false (≈3N allocations per deny against N origins); and the ledger retained the raw, uncapped, control-character-bearing authority, in an unbounded vector. | **Fixed** — `97fa7b3` (allocation), `ff897db` (record) |
| F5 | Medium | `handle` reached terminal states — timeout, oversized preamble, non-UTF-8, non-CONNECT, unparseable port — writing a 403 and recording nothing. `accepted=3, allowed=0, denied=0, healthy=true`. The spike's exact failure. | **Fixed** — `9bc0988` |
| F6 | Medium | `healthy()` was `accepted == completed`, and `completed` only ticks when a tunnel closes — so every keep-alive connection of a real scan read as a dead sensor, exactly when §9.3 needs the check. | **Fixed in part** — `9bc0988`. The liveness half is fixed. The lifecycle half is accepted; see below. |
| F7 | Medium | `panic = "abort"` in `[profile.release]` means `tokio::spawn(...).await` never returns `Err(JoinError::panic)`, so the join-based panic tripwire is dead code in every shipped artefact. | **Accepted**, with reason below. |
| F8 | Low | The accept-error arm called `yield_now`, which reschedules but does not throttle — a 100% CPU spin under the sustained descriptor exhaustion its own comment named. | **Fixed** — `c97386c` |
| F9 | Low | Data pipelined behind the CONNECT preamble was read into the buffer and discarded, stalling a handshake into a hang. Measured: upstream saw `"LATE"` of `"EARLYLATE"`. | **Fixed** — `8de2bc8` |
| F10 | Advisory | A multi-label public suffix (`co.uk`, `com.au`, `github.io`) contains a dot, so it is a usable origin and would allow all of `*.co.uk`. Same limitation as the TS predecessor. | **Accepted**, with reason below. |
| F11 | Advisory | The proxy is unauthenticated: any local process can use an active scan's allowance. | **Accepted**, carried to Phase 2. |
| F12 | Advisory | `Ledger::note_accepted` was `pub` while its paired recorders were private, so an outside caller could pin `healthy()` false. | **Fixed** — `c97386c` |
| F13 | Advisory | `"+443".parse::<u16>()` succeeds, so `CONNECT host:+443` was accepted. Cosmetic — the port used matched the port validated. | **Fixed** — `c97386c` |

### Accepted findings, with reasons

**F6, lifecycle half — accepted, carried to Phase 2.** Three sub-points: `copy_bidirectional` has
no idle timeout; scan origins are read once at CONNECT time and never revisited, so a tunnel
outlives the scan that authorised it; and `start` returns no stop handle, so the listener and
ledger are unreachable for the process lifetime (`lib.rs` discards the `ProxyHandle` with
`let _ =`). All three are real. None can be fixed here: **there is no scan lifecycle to revoke
against yet.** `scan_origins` is empty for the whole of this plan and Phase 2 is what fills it.
Fixing revocation before the thing being revoked exists would mean inventing the lifecycle inside
this task. Recorded as a Phase 2 requirement: *starting a scan must be able to end it, and ending
it must close tunnels opened under it.*

**F7 — accepted, with the comments corrected instead.** The choice is between unwinding panics
(which restores the tripwire but costs binary size, against the standing constraint that the
download be as small as possible) and abort (which is fail-closed: the process dies, the panic
hook writes a local crash line, and nothing escapes). Abort is the safer of the two for the
guard's actual promise. What was wrong was the *comment*, which described a mechanism the release
build does not have. `Cargo.toml` is also outside Task 10's declared file list. The residual risk
is real and stated plainly: **an abort mid-session destroys the user's unsaved project.** That is
a durability question for the save path, not an egress question, and it belongs with whatever
task revisits autosave.

**F10 — accepted.** Closing it properly requires a public suffix list, which is a large bundled
dependency against the size constraint, and which goes stale. More to the point, the threat model
does not reach: `scan_origins` is populated from a URL **the user typed**, not from anything an
attacker supplies. A user who types `co.uk` as their scan target has asked for something odd, not
been attacked. Documented rather than fixed.

**F11 — accepted, carried to Phase 2.** Loopback-only binding is correct and tested
(`proxy::the_listener_binds_loopback_only`). A per-run credential is the right answer and belongs
with the scan lifecycle, alongside F6.

---

## 4. What this audit could not determine

Named as such, rather than left implied:

1. **Whether the allocation claim now holds under measurement.** The deny path is
   allocation-free *by construction* — `vet_host` returns a borrowed slice, comparison is
   `eq_ignore_ascii_case` and length arithmetic — and this was verified by reading. It is **not**
   verified by a counting allocator. A `#[global_allocator]` in `cfg(test)` would be process-wide
   and its counts meaningless under the parallel test harness. If this claim is ever load-bearing
   for a performance decision, measure it properly rather than trusting this document.

2. **Whether the accept-error backoff behaves under real descriptor exhaustion.** F8's fix is
   reasoned, not tested: inducing a repeatable `accept()` failure is not something this suite can
   do portably across macOS and Windows. The failure mode if it is wrong is CPU, not egress.

3. **Whether `real_connector` behaves correctly end to end.** `connect_to_permitted` and
   `is_permitted_upstream` are tested directly, including the wiring test that proves a loopback
   address is refused *while something is listening on it*. The `lookup_host` call above them is
   not exercised, because doing so would mean the test suite performing name resolution — which
   Global Constraints forbid. Reviewed by reading only.

4. **Whether a poisoned `scan_origins` mutex fails closed in practice.** The degradation is
   `unwrap_or_default()` → empty list → `NoScanRunning`, which is correct by inspection.
   Deliberately poisoning a mutex from a test requires a panicking lock holder, which under
   `panic = "abort"` would abort the test process. Reviewed by reading only. This is the residue
   of retirement-table row 31.

5. **`commands.rs` and `project_file.rs` were not audited.** The auditor confirmed their tests
   pass and went no further; the IPC surface and the atomic-write path were outside this task's
   brief and were gated separately in Tasks 5 and 6.

6. **The behaviour of the shipped release binary was not observed.** All 67 tests run under the
   dev profile with unwinding. F7 is the known consequence; there may be others that only a
   release build would show.

---

## 5. Interface change made by this task

`Decision::Allow` gained a field. Task 3 declared:

```rust
pub enum Decision { Allow { origin: String }, Deny { reason: DenyReason } }
```

It is now:

```rust
pub enum Decision { Allow { host: String, origin: String }, Deny { reason: DenyReason } }
```

This is required by F1 and F3 together: the caller must record the host that was contacted and
must dial only the string the guard vetted, and neither was reachable from `origin` alone. The
alternative — re-normalising in the caller — would put the guard's rules in two places, which is
how the predecessor's defects happened. Task 3's stated interface should be read as amended.
