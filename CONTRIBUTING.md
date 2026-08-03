# Contributing to Traccia

Thanks for looking. Traccia is a small, deliberately narrow tool, and most of what follows
explains constraints that are load-bearing rather than stylistic. A change that breaks one of
them changes what the tool is, not how it is written.

## The non-negotiables

No outbound network traffic, except a scan of a URL the user explicitly entered. No telemetry,
no crash reporting, no update check, no CDN, no web font. Everything ships bundled. A pull
request that adds a network call for any other reason will be declined however useful it is,
because this promise is the reason the tool can be pointed at a real client's website in the
first place.

`src/core/` is pure. No `fs`, no `path`, no Tauri imports, no `Date.now()`, no `Math.random()`.
Timestamps and identifiers arrive as parameters. This is what lets the mapping logic be tested
without a browser, a filesystem or a clock, and the test suite leans on it completely.

Gaps are computed, never stored. What the tool does not yet know is derived on demand from what
it does know. It is never written into the project file and never edited by hand. Otherwise a
project file could assert that something had been answered when nothing answered it.

Copy about unknowns stays neutral. The words are "not yet identified". Not "violation", not
"non-compliant", not "missing". A sheet produced by this tool gets shown to the person paying
for the work, and an unanswered question is work still to do rather than an accusation.

Prefer a blank to a guess. `src/core/` is rule-based on purpose, with no model and no inference
about natural language. A case that genuinely needs a language model to get right is a
documented limit of the tool, not a feature request.

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

`cargo test` runs single-threaded on purpose. Some tests launch a real, ephemeral Chrome or Edge,
and several at once fight over the launcher.

## Three rules earned the hard way

These came out of a release where roughly half the work turned out to be rework. They are worth
more than any style guide in this file.

Measure against a real document, from the first change. A function that works is not the same
claim as a panel that says true things. Every accuracy defect on that release was found by
running a real privacy notice through the tool and counting how many answers were right. Not one
was found by a unit test.

A test that passes under a broken implementation is not a test. Before calling something done,
break the thing it added, watch that specific test fail, then restore it and confirm the diff is
empty. Eight tests once shipped that could not fail. The history has examples of this being done
properly and catching real defects; the collection-point id work is the clearest one.

Write the wrong answer down next to the rule. When you document a rule, document the mistake it
prevents. A rule that only says how something should work leaves the adversarial cases to be
discovered in review, which is the most expensive place to find them.

## Tests

`tests/core` is the suite that matters most. It is a baseline that moves deliberately, with the
count accounted for in the commit message that moves it, and it is not a ceiling: more tests are
welcome. It exists so that a drop in coverage is visible rather than silent.

`tests/fixtures/rossiEditore.ts` is a committed sample project used by the layout and panel
tests. It is fictional. Do not commit real client documents or real project files, since a
project file names an actual organisation and the data it processes.

## User-facing text

Every string a user reads lives in `src/renderer/strings.ts`, and a test enforces it. Adding
display text to a component will fail the build.

## Design documents

`docs/design/` holds the specification behind each release. `docs/decisions/` holds the record of
what was decided and what was measured, including where an earlier measurement turned out to be
wrong. Both are written to be read in order, and they are the fastest way to understand why the
tool is shaped the way it is.

## Pull requests

Open an issue first for anything substantial. The constraints above rule out more designs than
they look like they do, and finding that out before the work beats finding it out after. Small
fixes can go straight to a pull request.
