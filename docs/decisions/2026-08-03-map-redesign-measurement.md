# The controller-centred map — acceptance measured

**Recorded:** 2026-08-03, branch `map-redesign`, against the same saved project file as the
extraction-depth measurement (`docs/superpowers/plans/2026-08-03-extraction-depth-scan-baseline.md`):
one real small-business site scanned, one real informativa ingested, suggestions accepted. The
project file is not committed — it names a real organisation.

## What is counted, and why it changed

The v0.2 panel showed five fields per place and printed "not yet identified" in each one nobody
had answered. Counting those lines was the acceptance measure through v0.2.1: **55** of them on
this project.

This release stops drawing that construction. An unanswered field is not drawn at all; everything
unanswered is rolled into one line per selection. So counting empty-field lines would now measure
the copy change and nothing else — it would read zero, and zero would mean nothing.

**From this release on, the number is the count of unanswered questions the panel rolls up:** the
sum of `unknowns.count` across every place and the controller, which is the same set the printed
gaps sheet asks, stated once per selection instead of once per empty field. A door that is also a
collection place shares its questions with that place and is counted once.

## The measurement

| | v0.2.1 panel | this release |
|---|---|---|
| Unanswered, as drawn | 55 empty-field lines | **31 rolled-up questions** |
| — against places | 50 | 26 |
| — against the project as a whole | 0 (had nowhere to appear) | 5 |
| Facts actually stated | not counted | **21** |
| Distinct questions behind the count | — | 26 |

**55 → 31 is not 24 questions answered.** Almost all of it is reclassification: one place with
four empty fields used to print four lines and now contributes the two or three questions the gap
rules actually ask about it. No document was read that had not been read before, and no scan found
anything new — the project file is byte-identical to the one the previous release measured.

What genuinely changed in the reading:

- **Five project-level questions now have somewhere to appear.** "Who processes payroll?" belongs
  to the organisation rather than to any one place, and until the controller had a panel there was
  nowhere to put it. Those five are additions to the count, not removals.
- **21 facts are stated with attribution.** The old panel showed the same facts with no line
  saying who said them; a fact and a guess looked identical. This is the half of the measure the
  old number never captured, which is why it is recorded here alongside.
- **The captures from the previous release surface for the first time.** A discovered door's form
  fields and a place's cookies had no line in the old panel at all. On this project they are
  empty — that site sets no cookies before consent and the scan found no form — so they add
  nothing to this count. On a site that does collect, they will.

## What would move the number next

Nothing in the panel. The 26 distinct questions are the gap rules' own, and answering them means
reading documents that say more — jurisdiction and EEA facts above all, which is where 16 of the
55 sat in the v0.2.1 breakdown and where the largest single block still sits.

## Method

Counted from the saved project file by running `panelFor` over every place id, every door id and
`controller`, not by eye. The v0.2.1 figure of 55 was itself a correction: the original 59 had been
counted by eye and was wrong by four (see the extraction-depth baseline).
