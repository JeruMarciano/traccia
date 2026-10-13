/**
 * The sheet: tokens and the one stylesheet.
 *
 * Held as a string rather than a .css file so nothing has to be added to the build or to
 * tsconfig, and injected as a single <style> element, which the renderer's CSP allows
 * (`style-src 'self' 'unsafe-inline'`). No font is fetched or bundled: system stacks only.
 *
 * The look owes itself to Olivetti — Pintori's posters, the pale enamel of a Lettera 22.
 * That lineage is the point rather than a flourish: this is an Italian instrument for reading
 * machines, and Olivetti is what happens when someone decides a machine's output deserves to
 * be looked at. The map is a constellation, not a schematic.
 *
 * The notation the whole interface is built from, and the reason each mark exists:
 *
 *   cobalt disc       people, the origin of every line
 *   green ring        a system the organisation runs itself
 *   ochre ring        a supplier outside it
 *   dashed arc        the share of a group nobody has identified yet
 *   vermilion break   the data crosses out of the EEA
 *
 * Colour reinforces; it never carries a distinction alone. Ring against orbit says internal
 * or external before any hue does, a dashed stroke is dashed in greyscale, and the break mark
 * is a shape. The sheet prints in black and white without losing a single reading.
 */
import './print.css'
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
  padding:0 26px 20px;
}

:focus-visible{outline:2px solid var(--person);outline-offset:2px;}

/* Title block. A sheet a consultant leaves behind has to say what it is and when it was begun. */
.titleblock{
  display:flex;
  align-items:baseline;
  gap:16px;
  padding:20px 0 13px;
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
.drawn{font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;color:var(--ink-soft);}
.actions{margin-left:auto;display:flex;gap:7px;}
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
  transition:background .12s ease,color .12s ease;
}
.action:hover:enabled{background:var(--ink);color:var(--paper);}
.action:disabled{border-color:var(--rule);color:var(--ink-soft);cursor:default;}

/* The scan control: one field, one button, the field carrying the accent so the eye starts
   where the work starts. */
.scanbar{display:flex;gap:6px;padding:11px 0 0;max-width:330px;}
.scan-input{
  flex:1;
  min-width:0;
  font-family:var(--mono);
  font-size:10.5px;
  color:var(--ink);
  background:var(--paper-lift);
  border:1px solid var(--rule);
  border-radius:999px;
  padding:5px 11px;
}
.scan-visitor{font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;color:var(--ink-soft);max-width:330px;margin:5px 0 0;}
.scanbar .action{padding:4px 11px;font-size:10px;}
.scan-input::placeholder{color:var(--ink-soft);}
.scan-input:disabled{color:var(--ink-soft);}
.scan-input:focus-visible{outline:2px solid var(--person);outline-offset:1px;border-color:transparent;}

/* A message about this session, not about the client's data. */
.notice{
  display:flex;
  gap:16px;
  justify-content:space-between;
  align-items:baseline;
  margin:13px 0 0;
  padding:11px 15px;
  background:var(--paper-lift);
  border-left:3px solid var(--person);
  font-size:13px;
  line-height:1.45;
}

/* The map. A sheet 1000 units wide whose height follows from its rows; it scales with the width
   of its column, never below the width that keeps its smallest text at 9 px on screen. A sheet
   taller than the window scrolls rather than shrinking. */
.map{flex:1;display:flex;flex-direction:column;min-height:0;margin:0;}
.map-scroll{flex:1;min-height:0;overflow:auto;display:flex;}
.map-svg{display:block;flex:none;margin:auto;width:100%;min-width:${MAP_MIN_WIDTH}px;max-width:${MAP_MAX_WIDTH}px;height:auto;}
.col-head{font-size:12px;letter-spacing:.04em;fill:var(--ink-soft);}

/* The organisation: a bar every line crosses at its own height. */
.spine{fill:var(--paper-lift);stroke:var(--ink);stroke-width:1.4;}
.controller{cursor:pointer;}
.disc{fill:var(--person);}
.disc-home{fill:var(--paper);}

/* Lines. A way in's colour travels from the person to the destination. */
.path{fill:none;stroke-width:1.4;stroke:var(--rule);}
.path--neutral{stroke:var(--ink-soft);opacity:.6;}
.path--0{stroke:var(--door-1);}
.path--1{stroke:var(--door-2);}
.path--2{stroke:var(--door-3);}
.path--3{stroke:var(--door-4);}
.path--4{stroke:var(--door-5);}
.path--5{stroke:var(--door-6);}
.head--neutral{fill:var(--ink-soft);opacity:.6;}
.head--0{fill:var(--door-1);}
.head--1{fill:var(--door-2);}
.head--2{fill:var(--door-3);}
.head--3{fill:var(--door-4);}
.head--4{fill:var(--door-5);}
.head--5{fill:var(--door-6);}

/* Rows. One size for a row, one for a sub-row; the sizes themselves are set on the element from
   mapMetrics, so the width floor above and the text agree by construction. */
.row-label{font-weight:500;fill:var(--ink);}
.row-label--sub{font-weight:400;}
.row-soft{font-weight:400;fill:var(--ink-soft);}
.highlighted .row-label{font-weight:600;text-decoration:underline;}
.bracket{fill:none;stroke:var(--rule);stroke-width:1;}

/* Ways in. The mark says where the door comes from by ink, not by hue: filled for one the scan
   saw, outlined for one a document declared, dashed when neither is established. */
.subject,.door,.fold,.more,.node,.member{cursor:pointer;}
.door--0{color:var(--door-1);}
.door--1{color:var(--door-2);}
.door--2{color:var(--door-3);}
.door--3{color:var(--door-4);}
.door--4{color:var(--door-5);}
.door--5{color:var(--door-6);}
.door-mark{stroke:currentColor;stroke-width:1.6;}
.door-mark--discovered{fill:currentColor;}
.door-mark--declared{fill:var(--paper-lift);}
.door-mark--unsourced{fill:var(--paper-lift);stroke-dasharray:2 2;}
.door .bracket,.more .bracket{stroke:currentColor;}

/* Where it goes. The ring is the reading: solid for what somebody has identified, dashed for the
   share nobody has yet. Green for what the organisation runs itself, ochre for a supplier. */
.ring{fill:var(--paper-lift);stroke-width:1.6;stroke-dasharray:2 3;}
.ring-known{fill:none;stroke-width:2.2;}
.ring-count{font-size:12px;font-weight:500;fill:var(--ink);}
.member-mark{fill:var(--paper-lift);stroke-width:1.6;}
.member-mark--open{stroke-dasharray:2 2;}
.node--internal .ring,.node--internal .ring-known,.node--internal .member-mark{stroke:var(--internal);}
.node--external .ring,.node--external .ring-known,.node--external .member-mark{stroke:var(--external);}
.node .bracket,.member .bracket{stroke:var(--rule);}

.map-svg [role="button"]:focus-visible{outline:2px solid var(--person);outline-offset:2px;}
.map-svg [role="button"]:hover .row-label{text-decoration:underline;}
.dim{opacity:.16;}

.map-empty{
  margin:auto;
  padding:0 0 8vh;
  font-size:14px;
  color:var(--ink-soft);
  text-align:center;
}

/* The key. The notation is not common knowledge, and the sheet is read by someone seeing it
   for the first time, often on paper. */
/* One line, quiet. The key explains notation to someone seeing the sheet for the first time,
   which is worth a strip of the page and not a block of it: the map is the document. */
.legend{
  margin:0;
  padding:7px 0 0;
  border-top:1px solid var(--rule);
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:6px 24px;
}
.key{display:flex;gap:5px;align-items:center;}
.key-mark{flex:none;width:13px;height:13px;}
.key-mark--wide{width:22px;}
.key-term{font-size:9px;font-weight:600;letter-spacing:.02em;color:var(--ink-soft);}
.key-gloss{display:none;}

/* Found-in-documents suggestions: a working list. Nothing here is on the map until it is
   ticked onto it, so it reads as a proposal, not a finding. */
.suggestions{
  margin:14px 0 0;
  padding:14px 16px;
  background:var(--paper-lift);
  border-left:3px solid var(--internal);
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
.suggestions-count{margin-left:auto;font-size:15px;letter-spacing:0;}
.suggestions-read{margin:7px 0 0;font-family:var(--mono);font-size:9.5px;color:var(--ink-soft);}
.suggestions-caption{margin:5px 0 0;font-size:12px;line-height:1.45;color:var(--ink-soft);}
.suggestions-list{list-style:none;margin:12px 0 0;padding:0;}
.suggestion{padding:9px 0;border-bottom:1px solid var(--rule);}
.suggestion-row{display:flex;gap:10px;align-items:baseline;cursor:pointer;}
.suggestion-name{font-size:13.5px;}
.suggestion-tag{
  font-size:9px;
  font-weight:600;
  letter-spacing:.08em;
  text-transform:uppercase;
  border-radius:999px;
  padding:2px 8px;
  color:var(--paper-lift);
  background:var(--external);
}
.suggestion-tag--internal{background:var(--internal);}
.suggestion-group{font-family:var(--mono);font-size:9.5px;color:var(--ink-soft);}
.suggestion-evidence{margin:5px 0 0 27px;font-size:12px;line-height:1.4;color:var(--ink-soft);}
.suggestion-sources{margin:2px 0 0 27px;font-family:var(--mono);font-size:9px;color:var(--ink-soft);}
.suggestions-actions{display:flex;gap:7px;margin:13px 0 0;}

/* The detail bar: what the clicked point holds. Present only while something is selected, so
   the sheet is the drawing alone until a click asks a question of it. */
.detail{
  width:290px;
  flex:none;
  background:var(--paper-lift);
  border-left:1px solid var(--rule);
  padding:20px 24px 22px;
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
.detail-subject-name{margin:0;font-size:14px;}
.detail-subject-notes{margin:3px 0 0;font-size:12px;line-height:1.45;color:var(--ink-soft);}
.detail-place{padding:16px 0;border-bottom:1px solid var(--rule);}
.detail-place-name{margin:0;font-size:16px;font-weight:600;letter-spacing:-.01em;line-height:1.25;}
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
.detail-facts dt{
  margin:0;
  font-size:9px;
  font-weight:700;
  letter-spacing:.1em;
  text-transform:uppercase;
  color:var(--ink);
}
.detail-facts dd{margin:5px 0 0;font-size:13.5px;line-height:1.35;color:var(--ink);}
.detail-sub{
  margin:16px 0 0;
  font-size:9px;
  font-weight:600;
  letter-spacing:.1em;
  text-transform:uppercase;
  color:var(--ink-soft);
  border-top:1px solid var(--rule);
  padding-top:11px;
}
.detail-none{margin:8px 0 0;font-size:12px;color:var(--ink-soft);}

/* Under every fact: who said it. A footnote to the fact, not the fact, so it is small and
   quiet. Usually a filename, which says both what it is and where it came from. */
.detail-said-by{
  display:flex;
  align-items:center;
  gap:4px;
  margin:3px 0 0;
  font-size:9.5px;
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
.detail-facts dd.detail-said-by{margin:3px 0 0;}
.detail-totals{margin:10px 0 0;font-family:var(--mono);font-size:10px;color:var(--ink-soft);}

/* Everything nobody has answered, in one line that opens. Closed, it is a count; open, it is the
   same questions the printed gaps sheet asks. */
.detail-unknowns{margin:15px 0 0;border-top:1px solid var(--rule);padding-top:12px;}
.detail-unknowns summary{
  cursor:pointer;
  font-size:11px;
  font-weight:500;
  color:var(--ink);
  letter-spacing:.01em;
}
.detail-unknowns summary:hover{color:var(--person);}
.detail-unknowns ul{list-style:none;margin:8px 0 0;padding:0 0 0 12px;border-left:2px solid var(--rule);}
.detail-unknowns li{margin:0 0 9px;font-size:11.5px;line-height:1.4;color:var(--ink);}

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
.detail-reached-label{
  font-size:8.5px;
  font-weight:600;
  letter-spacing:.11em;
  text-transform:uppercase;
  color:var(--ink-soft);
}
.chip{display:inline-block;width:9px;height:9px;border-radius:2px;}
.chip--0{background:var(--door-1);}
.chip--1{background:var(--door-2);}
.chip--2{background:var(--door-3);}
.chip--3{background:var(--door-4);}
.chip--4{background:var(--door-5);}
.chip--5{background:var(--door-6);}
.detail-member--open{color:var(--ink-soft);}
.detail-declared{margin:10px 0 0;font-family:var(--mono);font-size:9.5px;color:var(--ink-soft);}
.detail-observations{list-style:none;margin:9px 0 0;padding:0;}
.detail-observations li{margin:0 0 6px;font-size:11.5px;line-height:1.4;color:var(--ink);}
.detail-door-link{all:unset;cursor:pointer;color:var(--ink);overflow-wrap:anywhere;}
.detail-door-link:hover{text-decoration:underline;}
.detail-door-link:focus-visible{outline:2px solid var(--person);outline-offset:2px;}

/* The map settles rather than appears: rings first, then what sits on them. A scan is the one
   moment this tool has to show something happening, and a drawing that arrives all at once
   reads as a picture instead of a reading. */
@keyframes fade-in{from{opacity:0;}to{opacity:inherit;}}
@keyframes settle{from{opacity:0;transform:scale(.9);}to{opacity:1;transform:scale(1);}}
.path{animation:fade-in .4s ease-out both;}
.node,.member,.subject,.door,.fold,.controller{
  animation:settle .32s ease-out both;
  transform-box:fill-box;
  transform-origin:center;
}

@media (prefers-reduced-motion:reduce){
  .path,.node,.member,.subject,.door,.fold,.controller{animation:none;}
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
`
