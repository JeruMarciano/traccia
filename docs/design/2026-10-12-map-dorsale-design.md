# Dorsale: the map redrawn so one line carries a datum from who comes in to where it goes

> **Superseded 2026-10-13.** The owner rejected the spine and the per-door lines after a real scan.
> The map is now four columns of cards with one line per way in and one per row of destinations
> (`src/core/layout.ts`). What survives from this document: rows, folds at three of a kind, the
> 9 px text floor, and scrolling instead of shrinking.

**Date:** 2026-10-12
**Status:** implemented on branch feat/map-dorsale-2, which continues feat/map-dorsale (plan docs/plans/2026-10-12-map-dorsale.md).
**Mockups:** https://claude.ai/artifact/FP7wjqwr4Z8wMR1ni5hnUk (today's map and three directions on
three real scans). The same page is committed beside this file as
`2026-10-12-map-dorsale-mockup.html`; its script is a working sketch of the geometry below.
**Replaces:** §3 "The map layout" of the Lettera design
(`docs/design/2026-09-29-lettera-ui-design.md`, commit 34dd71d on `Jeru/objective-allen-888569`),
and amends its §8. Lettera §2 and §4–7 (identity, panel, first run, type, dark variant, strings)
stand as approved.
**Out of scope:** `src-tauri/`, the scanner, the panel's content, document ingestion.

## 1. Why Lettera's map section is reopened

The user, on 2026-10-12, after trying the app with the upgraded scanner: the map is still too
complicated to read, it overlaps, it does not give a clear flow of the datum.

All 55 scans of the R5 bench were run through `ingestScan` and `computeLayout`. Three were drawn in
the live app (a restaurant: 2 doors; an estate agency: 7; an oil mill with a shop: 15 doors, 40
places on the right).

| What a real scan produces | Range over 55 sites |
|---|---|
| Doors | 1 to 19; 32 sites have 7 or more; 26 exceed the cap of 8 |
| Longest door label | 19 to 233 characters |
| Purpose groups on the right | 1 to 5 |
| Places in the largest group | 1 to 17 |
| Subject groups | 1 ("Website visitors") |

Lettera §3 was sized for the opposite case: about 12 groups and a handful of doors. It kept the door
column as it was ("labels centred under the mark"). What cannot be read today, and why:

1. **Door labels are written over each other.** A door needs about 40 units of height (mark, label,
   origin line) and gets 31 when eight share the 220-unit band. The label is a whole URL, centred
   under the mark, up to five times the column's width.
2. **Most doors have no line at all.** A form door has no recorded subject and no destination, so
   `computeLayout` draws no edge to or from it: 12 of the mill's 15 doors are marks hanging in the
   air. This, more than the overlap, is why no flow can be read.
3. **Colour distinguishes nothing.** Everything on the right is reached through one door (the site
   itself), so every outbound line is the same blue.
4. **One door per page is the wrong unit.** Twelve product pages with the same form are twelve doors.
5. **The right side says too little.** 40 places sit in 5 rings; the largest, opened, shows 5 of 17.
   Half the sheet is empty.

## 2. Decision

Three directions were drawn on the same three scans: A "Colonne" (Lettera's rows extended to the
left, the organisation still a point), B "Dorsale" (the organisation as a vertical bar every line
passes through), C "Registro" (a table, one row per door, no lines). The user chose **B**.

A cleans the labels but leaves the flow cut in two at the centre, readable only by colour. C writes
the flow instead of drawing it and loses the reverse reading (who receives from several doors).
Ribbons whose width shows volume were considered and not drawn: width would claim a quantity of
data the app does not measure.

## 3. The layout (in `computeLayout`)

Left to right: whose data, ways in, the organisation, where it goes. The drawing is 1000 units wide;
its height is set by its rows. Each rule is followed by the case that breaks it.

### 3.1 Ways in are rows

1. **A door is a row:** its mark in a fixed column, its label to the right of the mark and above its
   own line, the line running under the label to the row's end and on to the spine. Row pitch 36.
   Nothing is centred under a mark.
   - *Breaks when:* the label is longer than the row (about 34 characters at 13 units). It is
     shortened in the middle with an ellipsis; the full label is in the tooltip and the panel.
2. **Three or more doors of one kind are one row** ("Forms on 12 pages", "Embedded content (4)").
   The kinds are the scanner's five. Doors that are places declared in a document, and the site
   itself, are never grouped. Order: declared doors and the site first, then form, newsletter,
   booking, chat, embed; inside a kind, the existing order.
   - *Breaks when:* a site has two doors of each of the five kinds plus the site: 11 rows, none
     grouped. 11 × 36 = 396 units, which fits. This is the worst closed case.
3. **A grouped row opens in place**, like a purpose group: its doors become sub-rows under it (pitch
   24), joined by a bracket; rows below move down. Which kind is open is a parameter of
   `computeLayout`, beside the open group; both can be open at once. At most 6 sub-rows: past that,
   5 and a "+N more" row.
   - *Breaks when:* the selected door is inside a closed kind, or behind "+N more". The row that
     hides it is highlighted, so a selection is never drawn nowhere.
4. **A form is named by its page's path** ("/contatti/"), not the whole address; the site's own
   root is named by a string, "Home page". The host is the site every door shares and is already
   the first row.
   - *Breaks when:* two paths share their first and last 16 characters and differ in the middle.
     Both rows read the same when shortened; the tooltip and the panel tell them apart.
5. **The origin caption leaves the map.** "discovered by the scan" stays in the door panel. On the
   map the mark carries it: filled for a door the scan observed, outline for one a document
   declared, dashed outline when neither is established.
   - *Breaks when:* in black and white a filled and an outlined mark of the same hue are still
     different shapes of ink, so nothing is lost. A reader who does not know the notation finds it
     in the legend, which gains one entry.

### 3.2 Who comes in

6. **Every door found on the scanned site is reached by "Website visitors".** Today only the site
   door has that link, which is why forms float. This is a deduction, accepted by the user: a form
   on the site is used by people visiting the site. It is derived when paths are traced, not stored
   in the project file, so projects saved by v0.3 gain the lines too.
   - *Breaks when:* a project has no "Website visitors" group (documents only, no scan). Then no
     door was discovered either, and the rule adds nothing.
   - *Does not apply to:* a door declared in a document. Its subjects are whatever the document's
     flows say, as today.
7. **People are a column of discs with the name to the left of the disc**, right-aligned, so no
   line crosses a name. Pitch 64. A line runs from each group to each top-level row it reaches; a
   grouped row takes one line, and its bracket carries it to the sub-rows.
   - *Breaks when:* a document project has many subject groups. At 12 groups and 8 rows there can
     be 96 inbound lines. Declared limit: beyond 6 subject groups the inbound side is correct but
     dense; the selection highlight is what a reader uses there.

### 3.3 The organisation is a spine

8. **The organisation is a vertical bar**, 14 units wide, as tall as the drawing, with the house
   mark and its name above it. The empty name still reads "Your organisation".
   - *Breaks when:* the name is long. It sits above the bar, left-aligned from the mark, with the
     whole width to the right edge; past that it is shortened at the end.
9. **A door's line enters the spine at the door's own height and leaves from there.** It is one
   line, one colour, from the person to the destination.
   - *Breaks when:* a door low on the left goes to a destination high on the right. Its line
     crosses the others'. They stay apart by colour and, in print, by dash pattern.
10. **A door with several destinations leaves from points 5 units apart**, centred on its height,
    in the vertical order of its targets so its own lines never cross each other.
    - *Breaks when:* the fan is taller than the row. A door with k targets needs 5 × (k − 1) units;
      its row grows to that plus 16 when it exceeds the pitch. At 12 groups the site's row is 71
      units tall.
11. **A door that goes nowhere further stops at the spine**, with its arrowhead on the bar. That is
    what is known: the organisation receives it.
    - *Breaks when:* a reader takes "stops here" for "is not passed on". The door panel says what
      is known, in the existing neutral words; the map does not add a claim.
12. **A destination no door reaches gets one neutral grey line**, straight from the spine at the
    destination's own height. As today, no door is invented for it.

### 3.4 Where it goes

13. **Destinations are rows**, as in Lettera §3.1–3.2: ring in a fixed column with the count
    inside, name to its right, own systems first, then suppliers; an open group lists its members
    as sub-rows (pitch 24) under a bracket, at most 6, then "+N more". The dashed share of a ring
    is the share not yet identified, and the row says it in words after the name ("5 not yet
    identified").
    - *Breaks when:* two doors reach the same row. Their arrowheads land 3 units apart.
    - *Breaks when:* the open group's selected member is behind "+N more": that row is highlighted.
14. **When a group is open, lines go to its members**, not to the group; a door that reaches
    hidden members has one line of its own to "+N more".

### 3.5 The sheet

15. **The drawing grows with its rows and scales to the window**, as in Lettera §3.4. Target: at a
    1180×740 window with the panel open, labels are 9 px or more on screen (held by construction: nothing on the map is set under 12
    units and the sheet is never drawn under 750 px wide) for the worst real case
    with the largest group and the forms both open. Below that floor the sheet stops shrinking and
    scrolls vertically.
    - *Breaks when:* printing. Print has no scroll; the sheet scales to the page, and an oversized
      project prints small. Documented limit.
16. **Labels are part of the layout result** (position, anchor, the box they may fill), so a test
    checks that no two label boxes overlap and none crosses a line of another row. Shortening the
    text is the renderer's job and is a pure function with its own test. `computeLayout` stays a
    pure function of the project and the view (open group, open door kind, selection); the sheet is
    always 1000 units wide and its height is a result.

### 3.6 Caps

- The cap of 8 doors and the "+N more" door mark are **removed**: rule 2 makes them unnecessary
  (worst closed case 11 rows).
- The cap of 6 members per open group **stays**, and the same number caps an open door kind.

## 4. What changes for the reader

| Today | Dorsale |
|---|---|
| Door label centred under the mark, a whole URL | Label beside the mark, a path, shortened in the middle |
| "discovered by the scan" under every door | In the panel; the mark's fill carries it |
| A form has no lines | Visitors → form → the organisation |
| The organisation is a disc where lines meet | A bar each line crosses at its own height |
| Groups on an arc, members in a ring | Rows, members as sub-rows |
| 8 doors then "+N more" | Kinds of three or more fold into one row that opens |

## 5. Strings (all in `src/renderer/strings.ts`, English, neutral)

- Grouped rows: "Forms on {n} pages", "Newsletters ({n})", "Bookings ({n})", "Chats ({n})",
  "Embedded content ({n})".
- "Home page" for a form on the site's root.
- "{k} not yet identified" after a group's name (omitted when k = 0, and on the group that is
  itself "Not yet identified").
- Column heads, small and quiet: "Whose data", "Ways in", "Where it goes".
- Legend: one entry for the door mark's three states.
- `doorDiscovered` and `doorDeclared` stay; they are no longer drawn on the map.

Core holds no words the user reads: `computeLayout` returns a kind and a count for a grouped row
and the bare path for a form; the renderer picks the words.

## 6. Fixtures and measures

Real scans name real organisations, so the fixtures are the three bench scans with the scanned host
and any name in a path replaced (the mockup's data was made this way), saved as project files under
`tests/fixtures/`:

- **Small:** R5 run 20. 2 doors, 3 groups, 9 places.
- **Medium:** R5 run 43. 7 doors (6 forms), 3 groups, 13 places.
- **Ugly:** R5 run 15. 15 doors (12 forms, labels to 106 characters), 5 groups, 40 places, a group
  of 17.
- **Oversized, synthetic:** 30 purpose groups; 19 doors (10 forms, one with a 233-character path,
  two of each other kind, one declared in a document); an open group of 14; 12 subject groups; no
  controller name.

Targets, on every fixture, closed and with the largest group and the forms open: no two label boxes
overlap; every door has a line in and a line to the spine; every line ends at a row; a selection
behind a fold highlights the fold; two runs give identical output. On the three real fixtures, the
9 px floor of rule 15 holds.

A screenshot of the real app on the ugly fixture, before and after, closes the plan. A passing
suite is not the claim; the screenshot is.

## 7. Cost

- No new runtime dependency. The mockup's whole geometry is about 90 lines of plain arithmetic.
- `src/core/layout.ts`: rewritten. New in the result: row boxes and label boxes, the grouped-door
  node kind, and for each edge the height at which it meets the spine.
- `src/core/doors.ts`: `tracePaths` gains rule 6.
- `src/core/doors.ts` also decides the rows (`doorRows`) and gives a door its row's colour; `src/core/panel.ts` gains the panel of a folded row.
- `src/renderer/components/MapView.tsx`: the drawing of rows, the spine, curved paths and the
  bracket; print dash patterns per door colour stay.
- `tests/core/layout.test.ts` (418 lines): the geometry assertions (arc, ring, columns) are
  rewritten; the invariants (one controller, nothing drawn twice, hidden selection highlighted,
  determinism) are kept and re-pointed. `tests/renderer/mapView.test.tsx` (185 lines): about half.
- The `tests/core` count moves and is accounted for per task, as CLAUDE.md requires.

## 8. Order

The map comes first and is useful on its own: it is what the user cannot read today. Lettera's
remaining sections (panel, type, dark variant, first run) follow in the same plan as later batches
or in their own; the plan session decides, and nothing here depends on them.

## 9. Limits found while building

Measured 2026-10-13 in the running app on the three real scans (anonymised), window 1180×740,
closed and with the forms and the largest group open and the panel open: the smallest text is
10.06 px, no two labels touch, and every way in has a line in from the visitors and a line to the
bar. Pictures: `img/2026-10-12-dorsale-before.png`, `…-after.png`, `…-after-open.png`,
`…-print.png`.

- **A colour is a row's, not a door's.** A rescan that changes the number of rows shifts the
  colours below it. Stable for one file as saved, not across scans.
- **A folded row has a panel of its own**, which this document did not ask for: it lists every
  door of the kind, each one selectable. Without it, seven of the twelve forms of the worst real
  case could be reached by no click. Choosing a hidden one highlights "+N more" (or the closed
  row) in its place.
- **A label is shortened by whole characters.** An accented pair, a flag or a joined emoji is
  never cut in the middle; the width of a label is still an estimate (0.52 of the font size per
  character), since the map is drawn without measuring text.
- **With a place selected, everything that does not lead to it is drawn faint**, the other rows'
  arrowheads included. On the worst case with both folds open this leaves one line at full
  strength and about forty marks faint: correct, and sparse to look at.
- **On paper the four rows are four dash patterns** and can be followed in black and white. An
  oversized project prints small (no scroll on paper).
- **Not the map's doing, found while taking the print picture:** the scan bar, the action buttons
  and the notice are still drawn under print, because the rule that hides them loses to the theme
  stylesheet. It was so before this work; it is recorded as its own task.
- **Not independently reviewed task by task.** Tasks 1–6 had a reviewer each. For Tasks 7–10 the
  session could not launch one; the plan's code had been run end to end beforehand, each task's
  test was watched failing, and the proof above is what stands for them.
