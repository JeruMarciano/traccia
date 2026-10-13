/**
 * The sheet: tokens and the one stylesheet.
 *
 * Held as a string rather than a .css file so nothing has to be added to the build or to
 * tsconfig, and injected as a single <style> element, which the renderer's CSP allows
 * (`style-src 'self' 'unsafe-inline'`). No font is fetched or bundled: system stacks only.
 *
 * The rules the whole window keeps, so it reads as one instrument:
 *
 *   one accent        cobalt, for the wordmark, focus and what is live. Green, ochre and the six
 *                     door colours are notation on the map, never decoration on the chrome.
 *   two corners       controls (buttons, fields, tags) are pills; surfaces (cards, notices,
 *                     panels) take --radius. Nothing else is rounded.
 *   one type scale    10 for a label, 11 for a control or a footnote, 12 for secondary text,
 *                     13 for reading, 16 for the name of the thing in hand, 19 for the project.
 *                     Monospace only for what a machine wrote: an address, a date, a file name.
 *   one rhythm        spacing in steps of 4.
 *   quiet labels      one small-caps heading per panel; everything under it is sentence case.
 *
 * The look owes itself to Olivetti — Pintori's posters, the pale enamel of a Lettera 22.
 * That lineage is the point rather than a flourish: this is an Italian instrument for reading
 * machines, and Olivetti is what happens when someone decides a machine's output deserves to
 * be looked at. The map is a constellation, not a schematic.
 *
 * The notation the whole interface is built from, and the reason each mark exists:
 *
 *   cobalt disc       people, the origin of every line
 *   coloured bar      a way in: filled, outlined or dashed by where it was learned of
 *   green block       a system the organisation runs itself
 *   ochre ring        a supplier outside it
 *   dashed ring       what nobody has identified yet
 *
 * Colour reinforces; it never carries a distinction alone. Block against ring says internal or
 * external before any hue does, a dashed stroke is dashed in greyscale, and each way in's line
 * takes its own dash pattern on paper. The sheet prints in black and white without losing a
 * single reading.
 */
// The print rules are read as text and appended below, last in the one <style> element. A media
// query adds no weight, so on paper `.scanbar{display:none}` only beats the screen's
// `.scanbar{display:flex}` by coming after it; imported as its own stylesheet, print.css landed
// in <head>, ahead of every rule here, and lost each of those ties.
import PRINT from './print.css?raw'
import { MAP_MAX_WIDTH, MAP_MIN_WIDTH } from './mapMetrics'

export const STYLESHEET = `
:root{
  /* Pale enamel, the grey-green of a Lettera 22 — cool where every default is cream. */
  --paper:#E4E7E1;
  --paper-lift:#EDEFEA;
  --ink:#191B19;
  --ink-soft:#5F665F;
  --rule:#C2C8C0;
  --person:#2648C8;
  --internal:#1F6F4A;
  --external:#B4791A;
  --crossing:#CE3B22;
  /* Six door colours, and the palette cycles rather than growing: a seventh door repeats the
     first, and its label is what tells them apart. Generating hues until they stop being
     tellable apart would be the wrong answer. */
  --door-1:#2648C8;
  --door-2:#1F6F4A;
  --door-3:#B4791A;
  --door-4:#7A3E9D;
  --door-5:#0F7C8C;
  --door-6:#A33C5B;
  --radius:6px;
  --sans:"Avenir Next",Avenir,Futura,"Century Gothic","URW Gothic","Segoe UI",system-ui,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}

*{box-sizing:border-box;}

.sheet{
  display:flex;
  height:100vh;
  background:var(--paper);
  color:var(--ink);
  font-family:var(--sans);
  -webkit-font-smoothing:antialiased;
}
.plate{
  display:flex;
  flex-direction:column;
  flex:1;
  min-width:0;
  min-height:0;
  padding:0 24px 16px;
}

:focus-visible{outline:2px solid var(--person);outline-offset:2px;}

/* Title block. A sheet a consultant leaves behind has to say what it is and when it was begun. */
.titleblock{
  display:flex;
  align-items:baseline;
  gap:16px;
  padding:20px 0 12px;
  border-bottom:1px solid var(--rule);
}
.wordmark{
  font-size:12px;
  font-weight:600;
  letter-spacing:.42em;
  text-transform:uppercase;
  color:var(--person);
}
.project{font-size:19px;font-weight:400;letter-spacing:-.01em;margin:0;min-width:0;}
.drawn{font-family:var(--mono);font-size:10px;letter-spacing:.04em;color:var(--ink-soft);}
.actions{margin-left:auto;display:flex;gap:8px;}
.action{
  font-family:var(--sans);
  font-size:11px;
  font-weight:500;
  letter-spacing:.04em;
  color:var(--ink);
  background:none;
  border:1px solid var(--ink);
  border-radius:999px;
  padding:6px 14px;
  cursor:pointer;
  white-space:nowrap;
  transition:background .12s ease,color .12s ease,transform .08s ease;
}
.action:hover:enabled{background:var(--ink);color:var(--paper);}
/* A press is felt: the one piece of feedback a flat button can give. */
.action:active:enabled,.answer-choice:active{transform:translateY(1px);}
.action:disabled{border-color:var(--rule);color:var(--ink-soft);cursor:default;}

/* The scan control: one field, one button, the field carrying the accent so the eye starts
   where the work starts. */
.scanbar{display:flex;gap:8px;padding:12px 0 0;max-width:360px;}
.scan-input{
  flex:1;
  min-width:0;
  font-family:var(--mono);
  font-size:11px;
  color:var(--ink);
  background:var(--paper-lift);
  border:1px solid var(--rule);
  border-radius:999px;
  padding:5px 12px;
}
/* A sentence, so it is set as one: monospace is for what a machine wrote. */
.scan-visitor{font-size:11px;line-height:1.45;color:var(--ink-soft);margin:6px 0 0;}
.scanbar .action{padding:4px 12px;}
.scan-input::placeholder{color:var(--ink-soft);}
.scan-input:disabled{color:var(--ink-soft);}
.scan-input:focus-visible{outline:2px solid var(--person);outline-offset:1px;border-color:transparent;}

/* A message about this session, not about the client's data. */
.notice{
  display:flex;
  gap:16px;
  justify-content:space-between;
  align-items:baseline;
  margin:12px 0 0;
  padding:10px 14px;
  background:var(--paper-lift);
  border:1px solid var(--rule);
  border-radius:var(--radius);
  font-size:13px;
  line-height:1.45;
}

/* The map. A sheet 1000 units wide whose height follows from its rows; it scales with the width
   of its column, never below the width that keeps its smallest text at 9 px on screen. A sheet
   taller than the window scrolls rather than shrinking. */
.map{flex:1;display:flex;flex-direction:column;min-height:0;margin:0;}
.map-scroll{flex:1;min-height:0;overflow:auto;display:flex;}
.map-svg{display:block;flex:none;margin:20px auto auto;width:100%;min-width:${MAP_MIN_WIDTH}px;max-width:${MAP_MAX_WIDTH}px;height:auto;}
.col-head{font-size:12px;font-weight:600;letter-spacing:.06em;fill:var(--ink-soft);}
.col-rule{stroke:var(--rule);stroke-width:1;}

/* Cards. Every stop on the sheet is one: a lifted fill, a hairline, one corner (set on the
   element, with the rest of its geometry). The organisation's is drawn in ink, because it is the
   one everything passes through; nothing else on the sheet is told apart by weight alone. */
.card-box{fill:var(--paper-lift);stroke:var(--rule);stroke-width:1;transition:stroke .12s ease;}
.controller .card-box{stroke:var(--ink);stroke-width:1.2;}
.card-rule{stroke:var(--rule);stroke-width:1;}
.sub-box{fill:transparent;transition:fill .12s ease;}
.home{fill:var(--ink);}
.disc{fill:var(--person);}
.count{fill:var(--ink-soft);font-variant-numeric:tabular-nums;}
.chevron{fill:none;stroke:var(--ink-soft);stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;}

/* Lines. A way in's line is its colour from the people to the organisation; the organisation's
   own lines, out to where the data goes, are neutral. */
.path{fill:none;stroke-width:1.5;stroke-linecap:round;stroke:var(--ink-soft);}
.path--neutral{stroke:var(--ink-soft);}
.path--0{stroke:var(--door-1);}
.path--1{stroke:var(--door-2);}
.path--2{stroke:var(--door-3);}
.path--3{stroke:var(--door-4);}
.path--4{stroke:var(--door-5);}
.path--5{stroke:var(--door-6);}
.head--neutral{fill:var(--ink-soft);}
.head--0{fill:var(--door-1);}
.head--1{fill:var(--door-2);}
.head--2{fill:var(--door-3);}
.head--3{fill:var(--door-4);}
.head--4{fill:var(--door-5);}
.head--5{fill:var(--door-6);}

/* Rows. One size for a card's own row, one for a sub-row; the sizes themselves are set on the
   element from mapMetrics, so the width floor above and the text agree by construction. */
.row-label{font-weight:500;fill:var(--ink);}
.row-label--sub{font-weight:400;}
.controller .row-label{font-weight:600;}
.row-soft{font-weight:400;fill:var(--ink-soft);}
.highlighted .row-label{font-weight:600;text-decoration:underline;}

/* Ways in. The mark says where the door comes from by ink, not by hue: filled for one the scan
   saw, outlined for one a document declared, dashed when neither is established. */
.subject,.door,.fold,.more,.node,.member,.controller{cursor:pointer;}
.door--0{color:var(--door-1);}
.door--1{color:var(--door-2);}
.door--2{color:var(--door-3);}
.door--3{color:var(--door-4);}
.door--4{color:var(--door-5);}
.door--5{color:var(--door-6);}
.door-mark{stroke:currentColor;stroke-width:1.4;}
.door-mark--discovered{fill:currentColor;}
.door-mark--declared{fill:var(--paper-lift);}
.door-mark--unsourced{fill:var(--paper-lift);stroke-dasharray:2 2;}

/* Where it goes. The shape of the mark is the reading, and the hue only repeats it: a block for
   what the organisation runs itself, a ring for a supplier, a dashed ring for what nobody has
   identified yet. */
.mark{stroke-width:1.8;}
.mark--internal{fill:var(--internal);stroke:var(--internal);}
.mark--supplier{fill:var(--paper-lift);stroke:var(--external);}
.mark--unidentified{fill:var(--paper-lift);stroke:var(--ink-soft);stroke-dasharray:2 2;}

/* What the pointer is on, and what is selected, in the card's own outline: no glow, no shadow. */
.map-svg [role="button"]:focus-visible{outline:none;}
@media screen{
  .map-svg [role="button"]:focus-visible>.card-box,
  .map-svg [role="button"]:focus-visible>.sub-box{stroke:var(--person);stroke-width:2;}
}
.map-svg [role="button"]:hover>.card-box{stroke:var(--ink-soft);}
.map-svg [role="button"]:hover>.sub-box{fill:var(--paper);}
.selected>.card-box{stroke:var(--ink);stroke-width:1.6;}
.selected>.sub-box{fill:var(--rule);}
/* Whatever the row in hand is not connected to steps back. */
.line,.map-svg [role="button"]{transition:opacity .15s ease;}
.dim{opacity:.16;}

.map-empty{
  margin:auto;
  padding:0 0 8vh;
  font-size:13px;
  color:var(--ink-soft);
  text-align:center;
}

/* The key. The notation is not common knowledge, and the sheet is read by someone seeing it
   for the first time, often on paper. */
/* One line, quiet. The key explains notation to someone seeing the sheet for the first time,
   which is worth a strip of the page and not a block of it: the map is the document. */
.legend{
  margin:0;
  padding:10px 0 0;
  border-top:1px solid var(--rule);
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:6px 28px;
}
.key{display:flex;gap:6px;align-items:center;}
.key-mark{flex:none;width:13px;height:13px;}
.key-mark--wide{width:22px;}
.key-term{font-size:10px;font-weight:500;letter-spacing:.02em;color:var(--ink-soft);}
.key-gloss{display:none;}

/* Found-in-documents suggestions: a working list. Nothing here is on the map until it is
   ticked onto it, so it reads as a proposal, not a finding. */
.suggestions{
  margin:12px 0 0;
  padding:14px 16px;
  background:var(--paper-lift);
  border:1px solid var(--rule);
  border-radius:var(--radius);
  max-height:62vh;
  overflow-y:auto;
}
.suggestions-head{
  display:flex;
  align-items:baseline;
  gap:9px;
  margin:0;
  font-size:11px;
  font-weight:600;
  letter-spacing:.14em;
  text-transform:uppercase;
}
.suggestions-count{margin-left:auto;font-size:16px;letter-spacing:0;}
.suggestions-read{margin:8px 0 0;font-family:var(--mono);font-size:10px;color:var(--ink-soft);}
.suggestions-caption{margin:5px 0 0;font-size:12px;line-height:1.45;color:var(--ink-soft);}
.suggestions-list{list-style:none;margin:12px 0 0;padding:0;}
.suggestion{padding:9px 0;border-bottom:1px solid var(--rule);}
.suggestion-row{display:flex;gap:10px;align-items:baseline;cursor:pointer;}
.suggestion-name{font-size:13px;}
.suggestion-tag{
  font-size:10px;
  font-weight:600;
  letter-spacing:.08em;
  text-transform:uppercase;
  border-radius:999px;
  padding:2px 8px;
  color:var(--paper-lift);
  background:var(--external);
}
.suggestion-tag--internal{background:var(--internal);}
.suggestion-group{font-size:11px;color:var(--ink-soft);}
.suggestion-evidence{margin:5px 0 0 27px;font-size:12px;line-height:1.4;color:var(--ink-soft);}
.suggestion-sources{margin:2px 0 0 27px;font-family:var(--mono);font-size:10px;color:var(--ink-soft);}
.suggestions-actions{display:flex;gap:8px;margin:12px 0 0;}

/* The detail bar: what the clicked point holds. Present only while something is selected, so
   the sheet is the drawing alone until a click asks a question of it. */
.detail{
  width:296px;
  flex:none;
  background:var(--paper-lift);
  border-left:1px solid var(--rule);
  padding:20px 24px 24px;
  overflow-y:auto;
}
.detail-head{
  margin:0;
  font-size:11px;
  font-weight:600;
  letter-spacing:.14em;
  text-transform:uppercase;
  color:var(--ink-soft);
}
.detail-subjects{list-style:none;margin:16px 0 0;padding:0;}
.detail-subject-name{margin:0;font-size:13px;}
.detail-subject-notes{margin:6px 0 0;font-size:12px;line-height:1.45;color:var(--ink-soft);}
.detail-place{padding:16px 0;border-bottom:1px solid var(--rule);}
.detail-place-name{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em;line-height:1.25;overflow-wrap:anywhere;}
/* A plain statement about the thing in hand, in the reading size. */
.detail-place>p:not([class]){margin:8px 0 0;font-size:13px;line-height:1.4;}
/* Two facts to a row: a reader takes in a paired grid faster than a long single file, and at
   five fields the column reached below the fold for nothing.
   What went wrong the first time was type, not structure. The field name was too faint to find,
   the answer too close to it to separate, and the attribution set in a monospace face wide
   enough to wrap "recorded by hand" onto two lines under every single fact. */
.detail-facts{
  margin:14px 0 0;
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:15px 14px;
}
.detail-facts>div{min-width:0;}
.detail-facts dt{margin:0;font-size:11px;font-weight:500;color:var(--ink-soft);}
.detail-facts dd{margin:4px 0 0;font-size:13px;line-height:1.35;color:var(--ink);}
/* A section inside the panel. Sentence case: the panel has one small-caps heading, at its top,
   and a second and third under it made every block look like the start of something. */
.detail-sub{
  margin:16px 0 0;
  font-size:11px;
  font-weight:600;
  color:var(--ink-soft);
  border-top:1px solid var(--rule);
  padding-top:12px;
}
.detail-none{margin:8px 0 0;font-size:12px;color:var(--ink-soft);}

/* Under every fact: who said it. A footnote to the fact, not the fact, so it is small and
   quiet. Usually a filename, which says both what it is and where it came from. */
.detail-said-by{
  display:flex;
  align-items:center;
  gap:4px;
  margin:3px 0 0;
  font-size:10px;
  letter-spacing:.01em;
  color:var(--ink-soft);
}
/* One line, always. A document name long enough to wrap put two lines of footnote under a
   one-line answer, which is what made the panel look like an undifferentiated block. The whole
   name is on the element's tooltip. */
.detail-said-by span{
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
/* Restated here because the rule for a fact's answer outranks the class alone, and it set the
   footnote in the answer's own size and ink. */
.detail-facts dd.detail-said-by{margin:3px 0 0;font-size:10px;color:var(--ink-soft);}
.detail-totals{margin:8px 0 0;font-size:12px;line-height:1.45;color:var(--ink-soft);}

/* Everything nobody has answered, in one line that opens. Closed, it is a count; open, it is the
   same questions the printed gaps sheet asks. */
.detail-unknowns{margin:16px 0 0;border-top:1px solid var(--rule);padding-top:12px;}
.detail-unknowns summary{
  cursor:pointer;
  font-size:11px;
  font-weight:500;
  color:var(--ink);
  letter-spacing:.01em;
}
.detail-unknowns summary:hover{color:var(--person);}
.detail-unknowns ul{list-style:none;margin:8px 0 0;padding:0 0 0 12px;border-left:2px solid var(--rule);}
.detail-unknowns li{margin:0 0 9px;font-size:12px;line-height:1.4;color:var(--ink);}

/* Answering a question in place. Deliberately plain: this is a person filling in what the map
   could not work out, not a form. */
.answer{display:flex;gap:5px;margin:4px 0 0;}
.answer-input{
  flex:1;
  min-width:0;
  font-family:var(--sans);
  font-size:11px;
  color:var(--ink);
  background:var(--paper);
  border:1px solid var(--rule);
  border-radius:999px;
  padding:3px 9px;
}
.answer-choice{
  font-family:var(--sans);
  font-size:10px;
  font-weight:500;
  color:var(--ink);
  background:none;
  border:1px solid var(--ink);
  border-radius:999px;
  padding:3px 10px;
  cursor:pointer;
}
.answer-choice:hover{background:var(--ink);color:var(--paper);}

/* The panel speaks the map's colour language: a door referenced here carries its door chip. */
.detail-reached{display:flex;align-items:center;gap:5px;margin:12px 0 0;}
.detail-reached-label{font-size:11px;font-weight:500;color:var(--ink-soft);}
.chip{display:inline-block;width:9px;height:9px;border-radius:2px;}
.chip--0{background:var(--door-1);}
.chip--1{background:var(--door-2);}
.chip--2{background:var(--door-3);}
.chip--3{background:var(--door-4);}
.chip--4{background:var(--door-5);}
.chip--5{background:var(--door-6);}
.detail-declared{margin:10px 0 0;font-family:var(--mono);font-size:10px;color:var(--ink-soft);}
.detail-observations{list-style:none;margin:9px 0 0;padding:0;}
.detail-observations li{margin:0 0 6px;font-size:12px;line-height:1.4;color:var(--ink);overflow-wrap:anywhere;}
.detail-door-link{all:unset;cursor:pointer;color:var(--ink);overflow-wrap:anywhere;}
.detail-door-link:hover{color:var(--person);text-decoration:underline;}
.detail-door-link:focus-visible{outline:2px solid var(--person);outline-offset:2px;}

/* The map settles rather than appears: lines first, then the cards on them. A scan is the one
   moment this tool has to show something happening, and a drawing that arrives all at once
   reads as a picture instead of a reading. */
/* Only the starting state is named: where the drawing lands is each element's own style, so a
   dimmed row stays dimmed. The wrong answer: a keyframe ending at opacity 1, which outlived the
   animation and held every card at full strength whatever was selected. */
@keyframes fade-in{from{opacity:0;}}
@keyframes settle{from{opacity:0;transform:scale(.97);}}
.path,.head{animation:fade-in .4s ease-out both;}
.people,.node,.member,.subject,.door,.fold,.more,.controller{
  animation:settle .32s ease-out both;
  transform-box:fill-box;
  transform-origin:center;
}

@media (prefers-reduced-motion:reduce){
  .path,.head,.people,.node,.member,.subject,.door,.fold,.more,.controller{animation:none;}
  .line,.map-svg [role="button"]{transition:none;}
}

@media (max-width:900px){
  .sheet{display:block;height:auto;}
  .detail{width:auto;border-left:0;border-top:1px solid var(--rule);padding:20px 24px 24px;}
}
@media (max-width:680px){
  .legend{grid-template-columns:repeat(2,minmax(0,1fr));}
}

/* The limits statement and the possible-gaps line: real text in the DOM at all times, so what
   prints can never drift from what the app knows, but of no use on this screen. print.css
   turns it back on inside @media print. */
.print-only{display:none;}
` + PRINT
