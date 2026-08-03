# The controller-centred map — design

**Date:** 2026-08-03
**Status:** implemented 2026-08-03 on branch `map-redesign`, plan `docs/superpowers/plans/2026-08-03-map-redesign.md`, measured in `docs/superpowers/plans/2026-08-03-map-redesign-baseline.md`. Two deviations decided during implementation, both recorded in the commits: a door place and the controller place are excluded from the purpose group on the right, because they are already drawn elsewhere and the ring's count said otherwise; and §5's open ring keeps its place in the column with its members set out around it, after the first run of the real app showed no way back to a ring that had been replaced.
**Builds on:** `2026-07-30-data-flow-mapper-design.md` (the core model), the v0.2 internal map, §2 of `2026-08-03-extraction-depth-design.md` (where this redesign was agreed in one paragraph).
**Sequenced after:** §5 of the extraction-depth spec (cookies, consent banner, form fields, storage keys). Those steps produce the doors this map draws; drawing them first would mean an inbound side with one door on it. Decided 2026-08-03.

Working title: *the map reads like a sentence*.

## 1. What changes and why

The v0.2 map answers "how much of this do we know?" well and answers three other questions not
at all: which way data moves, where it came in, and who answers for it. Those three are the
questions an accountability map exists for, and v0.2.1 now extracts the missing piece — the
controller's name — from documents. So the geometry changes from orbits to a sentence:

> whose data → through which door → to the controller → onward to whom.

## 2. The sheet, left to right

- **Inbound, far left: subject groups.** Employees, customers, website visitors — each a small
  filled node, connected to the door it comes through. Drawn from `Flow`s whose `from` is a
  SubjectGroup id.
- **Doors: collection points.** Every `Place` with `kind: 'collection'` is a door, drawn as a
  door — a small upright rectangle on the inbound side. Doors are *discovered* (a scanned form)
  or *declared* (a document says one exists); the caption under the door says which.
- **Centre: the controller, by name.** `Place.holder`/controller extraction (v0.2.1 §4.3)
  supplies the name. Until a document names one, the centre reads "Your organisation" — neutral
  copy, per the non-negotiable; never a guessed company name.
- **Outbound, right: purpose groups.** The rings survive, with their v0.2 reading intact: the
  circumference divides solid-for-identified, dashed-for-not-yet; the count sits inside; green
  stroke for a group the organisation runs itself, ochre for suppliers. What was "inner vs outer
  orbit" becomes stroke colour alone — distance now encodes direction, not ownership.

## 3. Direction on every line

Every line carries an arrowhead at its destination end. Inbound lines run person → door →
controller; outbound lines run controller → group (→ member, when a ring is open). No line on
the sheet is ambiguous about which way data moves.

**The wrong answer, written next to the rule:** a line drawn between two nodes with no
arrowhead because "the layout implies it". The v0.2 map implied it, and the implication is what
this release removes.

## 4. One colour per door, and the colour travels

Each door takes a colour from a fixed bundled palette, assigned deterministically by door id
order — same project, same colours, every open. A flow that originates at a door keeps that
door's colour along its whole path: person → door → controller → destination. Two doors feeding
the same destination are two thin parallel lines, separately traceable by eye, and the count of
lines into a node is itself a reading.

Rules, each with the answer that breaks it:

- **Colour repeats the story, never solely carries it.** Door identity lives in the label and
  position; on a photocopy the parallel lines survive as line count. *Wrong answer:* two doors
  distinguishable only by hue.
- **A place with no traced path from any door** (declared in a document, no flows recorded)
  connects to the controller with one neutral-coloured line. *Wrong answer:* inventing a door
  for it, or leaving it off the sheet.
- **The palette is finite (six colours) and cycles beyond six doors.** A cycled colour is
  acceptable because the label disambiguates; a growing palette of near-identical hues is not.
  *Wrong answer:* generating colours until they stop being tellable apart.
- **Colour is assigned to doors, not to purposes.** The v0.2 green/ochre purpose reading stays
  on the ring strokes and only there.

## 5. Rings open in place

Clicking a purpose-group ring expands it where it stands: the ring becomes a faint dashed
boundary, its member places appear inside as individual nodes — each with its own line, each
clickable for the detail panel. Clicking the background, or another ring, closes it; one ring
open at a time. A closed ring keeps the v0.2 dash-share reading; an open ring shows the same
fact as individual dashed member nodes ("not yet identified").

**The wrong answer:** an open ring that hides the unknowns because they have no name to show.
An unnamed member is drawn dashed with its host string, exactly as the suggestions panel already
names it.

## 6. EEA is a fact, not a mark

The "N outside the EEA" captions and the // line-breaks are not drawn. `leavesEEA` stays in the
schema (agreed, extraction-depth §2) and stays stated in the detail panel for a selected place.
The fact is kept; the mark is retired.

## 7. The detail panel

Agreed 2026-08-03 against a mockup, replacing the v0.2 below-the-map section, whose two defects
the mockup made visible: the answer to a click appears below the fold, and "not yet identified"
repeated per empty field is the loudest thing on the page.

- **A side panel; the map compresses and stays visible.** Selecting a node slides the panel in
  from the right and the map narrows to fit beside it. The selection stays at full strength
  while the rest dims (v0.2's dimming, kept). Click and answer are on screen together; nothing
  appears below the fold. *The wrong answer:* a panel that covers the map, or a click whose
  visible effect is nothing.
- **Facts first.** Only answered fields render as fields. Field copy stays in the v0.2 voice
  (WHERE, RETENTION, WHAT IS HELD) via `strings.ts`.
- **Every fact says who said it.** Under each fact, one small line: confidence plus source —
  "declared · informativa-clienti.pdf", "observed · scan of rossi-editore.it". Drawn from
  `sources` and `confidence`, which the model already carries. *The wrong answer:* a fact
  displayed with no attribution line because its `sources` array is empty — that renders as
  "recorded by hand", never invents a source, and never hides the fact.
- **Unknowns rolled up.** One line per selection: "N things not yet identified ▾", opening on
  click to the list of unanswered fields, in the same neutral words the gaps printout uses.
  Computed on demand, never stored, per the non-negotiable. *The wrong answer:* "0 things not
  yet identified" — when nothing is unknown the line is absent, not zero.
- **The panel speaks the map's colour language.** A door referenced in the panel ("reached
  from") carries its door colour chip.
- **Per node type:** a *place* shows its facts as above; a *door* shows who comes through and
  what is asked (form fields, from the scan — observed vs declared stated); the *controller*
  shows its name, the document that named it, and project totals; a *closed ring* shows its
  member list, each member opening the place panel; the EEA fact for a place is stated here and
  only here (§6).

## 8. What this means in code

- `src/core/layout.ts` — `computeLayout` is rewritten for the new geometry and stays a pure
  function of `(project, size)`: no `Date.now()`, no randomness, colours by deterministic index.
  The open/closed state of a ring is a parameter, not stored state.
- Door derivation, path tracing (door → destinations through `Flow`s) and colour assignment are
  pure `src/core/` functions, testable with fixtures.
- `MapView.tsx` renders what layout computes, as today. Selection and dimming survive.
- Nothing new in the project file: doors, paths and colours are all computed on demand from
  `places` and `flows`, like gaps. `schemaVersion` does not move.
- The print stylesheet keeps working: the sheet must remain a true reading in black and white
  (line count, dash share, labels).

## 9. Testing

- Layout fixtures: a project with zero doors, one door, seven doors (palette cycles), a place
  fed by two doors (two parallel lines), a declared place with no flows (neutral line), no
  controller named yet ("Your organisation").
- The real-fixture rule from CONTRIBUTING.md applies from the first task: the sample project used to approve
  this design (Rossi Editore srl — three subject groups, three doors, five purpose groups, two
  unknowns) becomes a committed fixture, and every layout claim is checked against what it
  actually draws.
- Break-and-watch applies: each drawing rule gets broken deliberately and its specific test
  watched to fail before the task is done.

## 10. Out of this release

- Any editing of doors or flows on the map itself. The map draws; the panels edit.
- Identifier detection, ROPA import, any AI — parked, unchanged.
- Removing `leavesEEA` from the schema — parked until another reason bumps `schemaVersion`.
- Animation beyond the ring opening. One thing moves on click.
