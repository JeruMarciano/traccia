# Release checklist — what is distribution-gated, and why it is not blocking code

**Date:** 2026-08-01
**Status:** open. Every item below needs an answer before a public release, and none of them
needs one before the next feature lands.

---

## The reasoning, once, so it does not get re-argued

The repository is **private** (checked 2026-08-01). Every item on this list is an obligation that
attaches to *distribution* — publishing the repository, attaching binaries to a GitHub release, or
handing a build to anyone outside the author. None of them attaches to writing, testing or
committing code in a private repository.

Two of them are commonly mistaken for prerequisites:

- **A missing LICENSE is not a defect today.** Absent a licence, all rights are reserved. That is
  the correct and safe default for a private repository. It only becomes wrong at the moment the
  intent — "let anyone try the tool" — meets the reality that nobody may legally do so.
- **The MPL-2.0 obligations are triggered by conveying the binary, not by depending on the
  crates.** MPL-2.0 is file-level copyleft with a source-availability obligation on distribution.
  Nothing is being conveyed while the repository is private.

So this is a checklist, opened now so the items are recorded and dated, and worked before the
first public release. It is deliberately not a Phase 2 task.

---

## The five items

### 1. LICENSE

No `LICENSE` file exists. Spec §8.1 requires dependency licences to permit "both commercial and
closed-source use, because the licence for this project is undecided" — so the project's own
licence is still an open decision, not merely an unwritten file.

**Needs:** a decision from the author on the project's licence, then the file.
**Gates:** making the repository public; any binary release.

### 2. README

None exists. A repository with binaries and no README asks a user to trust an unsigned download
from an unexplained project, which is the opposite of the product's pitch.

**Needs:** what the tool is, what it does not do, the privacy promise in §7 stated plainly, the
Gatekeeper/SmartScreen consequence stated honestly, and build instructions.
**Gates:** making the repository public.

### 3. Code signing — macOS Gatekeeper

Unsigned `.dmg`. macOS refuses to open the app until the user right-clicks and confirms. Spec
§8.1 records this as "a genuine adoption problem" for a tool whose pitch is trustworthiness, and
§11.3 defers it explicitly.

**Needs:** an Apple Developer account, then notarisation in the macOS CI job.
**Gates:** putting the app in front of anyone non-technical.

### 4. Code signing — Windows SmartScreen

Unsigned NSIS installer, 1,124,383 bytes, produced by the Windows CI runner added in Phase 1
Task 11. SmartScreen shows a warning. Now that CI produces Windows artefacts, the signing step
has an obvious home.

**Needs:** a Windows code-signing certificate, then a signing step in the Windows CI job.
**Gates:** the same moment as item 3.

### 5. MPL-2.0 in the dependency tree — the one that needs a real decision

Spec §8.1 states a Global Constraint: dependency licences must be MIT, Apache-2.0, BSD, ISC or
equivalent, and **"anything copyleft is excluded"**.

Five MPL-2.0 crates ship in the binary today. None was chosen; all are inherited transitively
from Tauri:

| Crate | Reached via |
|---|---|
| `cssparser` | `tauri-utils` |
| `cssparser-macros` | `tauri-utils` |
| `selectors` | `tauri-utils` |
| `dtoa-short` | `tauri-utils` |
| `option-ext` | `tauri` → `dirs` |

This is a genuine conflict between a stated constraint and the shipped artefact, and it does not
resolve itself. The options, stated without a recommendation because this is the author's call:

- **Amend the constraint.** Permit weak/file-level copyleft (MPL-2.0, LGPL) while continuing to
  exclude strong copyleft (GPL, AGPL). MPL-2.0's obligation is per-file and does not reach
  Traccia's own source; in practice it means offering the source of those five files, unmodified,
  which is satisfied by pointing at their upstream repositories. This is the cheap answer and it
  is defensible, but it is a change to a rule the spec calls a constraint.
- **Keep the constraint and accept the consequence.** Then Tauri is disqualified, which reverses
  the Phase 1 shell decision and the 64.7× size win with it. Not seriously proposed; recorded so
  nobody thinks it was overlooked.
- **Keep the constraint, scope it explicitly.** Narrow it to *directly chosen* dependencies, and
  record transitive MPL-2.0 as an accepted exception with these five crates named. Honest about
  what actually ships, and leaves the rule's intent — never take on a copyleft obligation by
  choice — intact.

Note this also touches spec §11.1's open question on the vendor dictionary, which was excluded on
the same "no copyleft" ground. Whichever way this is decided, decide it once for both.

**Needs:** the author's answer.
**Gates:** any distribution of a binary. Also, in practice, gates the Phase 3 vendor dictionary,
since several otherwise-suitable public tracker lists are copyleft.

---

## Still open from Phase 1, related but not release-gating

- **Full dependency licence audit of the shipped artefact.** `cargo tree` plus a licence check
  over the whole Rust tree. The five crates above were found by inspection, not by an audit; the
  audit may find more. Carried forward from the Tauri port plan.
