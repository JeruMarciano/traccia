# The map stops being readable as a project grows

**Observed:** 2026-08-03, v0.3.0, on a real project after documents were ingested. Roughly a dozen
purpose groups with members, against the five-group sample the redesign was drawn for.

Recorded now, in the state it was seen, because the next version starts here and a defect described
from memory is a defect described wrongly.

## What goes wrong

Everything below is visible in one screenshot of one real project, not inferred.

**Labels collide.** "Payroll adviser" and "Recruiting" overlap. So do "Occupational health" and
"HR management". "Office" sits on top of "Payroll system". Every label is centred under its mark
with no awareness of its neighbours, so two marks close together produce two labels in the same
place. Shortening the purpose-group names helped and did not solve it: these are place names, which
are whatever the vendor dictionary or the document called them.

**An open ring collides with itself.** Its members are set out around its centre at a fixed radius,
and the ring's own count sits in the middle. With five members the labels of the members overlap the
count, each other, and the rings on either side. The dashed boundary that is meant to enclose the
group instead crosses two neighbouring groups.

**The arrows fan.** Every outbound line leaves the controller from one point, so a dozen
destinations produce a dozen lines radiating from a single spot at slightly different angles. Near
the centre they are indistinguishable, which defeats the thing the colours were introduced for.

**Rings crowd their arc.** Groups are spread across a 200 degree arc at one radius. That reads well
at five and packs shoulder to shoulder at twelve, and nothing widens the arc, adds a second radius,
or reduces what is drawn.

## What this is not

Not a rendering bug, and not something a smaller font fixes. The geometry is fixed: one radius, one
label position per mark, one departure point for every line. It has no notion of how much room a
label needs, or of what else is nearby. Every dimension was tuned by eye against a five-group
sample, and it degrades the moment a project outgrows that.

## What the next version has to decide

Stated as questions, since the answers belong to a design conversation and not to this note.

- Does the sheet stay one drawing, or does it get a way to show part of a project at a time? A map
  that always shows everything will always break at some size.
- Where does label placement live? Anything that avoids collisions has to know where other labels
  are, which is a layout concern, and `computeLayout` is pure and testable, so it can own it.
- Do lines still leave the controller from one point, or from an edge, or through routed channels?
- Is there a level of detail below which a group is drawn as a count rather than as members?
- What is the largest project the sheet is meant to stay honest at? The real one behind this note
  is a fair target, and stating a number makes this testable rather than a matter of taste.

## What must survive whatever is chosen

- The reading the redesign bought: direction on every line, a door's colour travelling its whole
  path, solid against dashed for identified against not yet identified.
- Determinism. Same project and same selection, same sheet, every time.
- A sheet that prints, in black and white, with the same readings intact.
- `computeLayout` staying a pure function of its arguments.
