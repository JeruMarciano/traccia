# Contributing to Traccia

Thanks for looking. Traccia is a small, deliberately narrow tool, and most of what follows
explains constraints that are load-bearing rather than stylistic — a change that breaks one of
them is a change to what the tool *is*, not to how it is written.

## The non-negotiables

**No outbound network traffic, except a scan of a URL the user explicitly entered.** No telemetry,
no crash reporting, no update check, no CDN, no web font. Everything ships bundled. A pull request
that adds a network call for any other reason will be declined regardless of how useful it is —
this is the promise the tool is built on, and it is the reason it can be pointed at a real client's
website.

**`src/core/` is pure.** No `fs`, no `path`, no Electron or Tauri imports, no `Date.now()`, no
`Math.random()`. Timestamps and identifiers are passed in as parameters. This is what makes the
mapping logic testable without a browser, a filesystem or a clock, and the test suite depends on it
completely.

**Gaps are computed, never stored.** What the tool does not yet know is derived on demand from what
it does know. It is never written into the project file and never edited by hand — otherwise a
project file could assert that something was answered when nothing answered it.

**Neutral copy about unknowns.** The words are "not yet identified". Never "violation", never
"non-compliant", never "missing". A sheet produced by this tool is shown to the person paying for
the work; an unanswered question is work still to do, not an accusation.

**Prefer a blank to a guess.** `src/core/` is rule-based on purpose — no model, no inference about
natural language. When a case genuinely needs a language model to get right, that is a documented
limit of the tool, not a feature request.

## Getting set up

```bash
npm install
npm run dev
```

Rust toolchain 1.97.1 for the Tauri shell in `src-tauri/`.

## Checks

All four must pass before a change is ready. They are the same four the CI workflow runs.

```bash
npm test
npm run typecheck
```

```bash
cd src-tauri && cargo test --locked -- --test-threads=1
```

```bash
cd src-tauri && cargo clippy --locked --all-targets -- -D warnings
```

`cargo test` runs single-threaded on purpose: some tests launch a real, ephemeral Chrome or Edge,
and several at once contend for the launcher.

## Three rules earned the hard way

These came out of a release where roughly half the work turned out to be rework. They are worth
more than any style guide in this file.

**Measure against a real document, from the first change.** A function that works is not the same
claim as a panel that says true things. Every accuracy defect on that release was found by running
a real privacy notice through the tool and counting how many answers were right; not one was found
by a unit test.

**A test that passes under a broken implementation is not a test.** Before calling something done,
break the thing it added and watch that specific test fail, then restore it and confirm the diff is
empty. Eight tests once shipped that could not fail. The commit history has examples of this being
done, and of it catching real defects — see the collection-point id work.

**Write the wrong answer down next to the rule.** When you document a rule, document the mistake it
prevents. A rule that only says how something should work leaves the adversarial cases to be
discovered in review, which is the most expensive place to find them.

## Tests

`tests/core` is the suite that matters most; it is a baseline that moves deliberately, with the
count accounted for in the commit message that moves it. It is not a ceiling — more tests are
welcome. It exists so that a drop in coverage is visible rather than silent.

`tests/fixtures/rossiEditore.ts` is a committed sample project used by the layout and panel tests.
It is fictional. Do not commit real client documents or real project files: a project file names an
actual organisation and the data it processes.

## User-facing text

Every string a user reads lives in `src/renderer/strings.ts`, and a test enforces it. Adding
display text to a component will fail the build.

## Design documents

`docs/design/` holds the specifications behind each release, and `docs/decisions/` the records of
what was decided and what was measured, including where an earlier measurement was wrong. They are
written to be read in order and are the fastest way to understand why the tool is shaped as it is.

## Pull requests

Open an issue first for anything substantial — the constraints above rule out more designs than
they might appear to, and it is better to find that out before the work than after it. Small fixes
can go straight to a pull request.
