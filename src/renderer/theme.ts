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

/* The map */
.map{flex:1;display:flex;flex-direction:column;min-height:0;margin:0;}
.map-svg{flex:1;min-height:0;width:100%;height:100%;display:block;}
.map-empty{
  margin:auto;
  padding:0 0 8vh;
  font-size:14px;
  color:var(--ink-soft);
  text-align:center;
}

/* A door's colour travels the whole path, so two doors feeding one destination are two lines a
   reader can follow apart. Colour repeats the story; it never solely carries it -- the label and
   the position say the same thing, and print.css gives each colour its own dash pattern. */
.path{stroke:var(--rule);stroke-width:1.25;fill:none;}
.path--neutral{stroke:var(--rule);opacity:.65;}
.path--0{stroke:var(--door-1);opacity:.75;}
.path--1{stroke:var(--door-2);opacity:.75;}
.path--2{stroke:var(--door-3);opacity:.75;}
.path--3{stroke:var(--door-4);opacity:.75;}
.path--4{stroke:var(--door-5);opacity:.75;}
.path--5{stroke:var(--door-6);opacity:.75;}
.arrow path{fill:var(--ink-soft);}

/* A door is drawn as a door: a small upright rectangle standing in the inbound side. */
.door{cursor:pointer;}
.door-mark{fill:var(--paper-lift);stroke-width:2.5;}
.door--0 .door-mark{stroke:var(--door-1);}
.door--1 .door-mark{stroke:var(--door-2);}
.door--2 .door-mark{stroke:var(--door-3);}
.door--3 .door-mark{stroke:var(--door-4);}
.door--4 .door-mark{stroke:var(--door-5);}
.door--5 .door-mark{stroke:var(--door-6);}
.door:hover .door-mark{fill:var(--paper);}
.door-label{font-size:9px;font-weight:500;fill:var(--ink);}
.door-origin{font-family:var(--mono);font-size:7.5px;fill:var(--ink-soft);letter-spacing:.02em;}

.subject{cursor:pointer;}
.subject-label{font-size:9px;font-weight:500;fill:var(--ink);}
.disc{fill:var(--person);}
.disc-halo{fill:none;stroke:var(--person);stroke-width:1;opacity:.28;}
.disc-label{
  fill:var(--paper);
  font-size:10px;
  font-weight:600;
  letter-spacing:.2em;
}
.disc-count{fill:var(--paper);font-family:var(--mono);font-size:9px;opacity:.85;}
/* The centre carries a house and no text: the organisation is named on the title block, in this
   mark's tooltip, and in the panel a click opens. */
.controller{cursor:pointer;}
.disc-home{fill:var(--paper);}
.controller:hover .disc-halo{opacity:.55;}

.node{cursor:pointer;}
.node-fill{fill:var(--paper-lift);}
.node-arc{fill:none;stroke-width:2.5;stroke-linecap:butt;}
.node--internal .node-arc{stroke:var(--internal);}
.node--external .node-arc{stroke:var(--external);}
.node-arc--open{stroke-dasharray:3 4;opacity:.75;}
.node-count{font-size:13px;font-weight:500;fill:var(--ink);}
.node-label{
  font-size:9.5px;
  font-weight:500;
  letter-spacing:.05em;
  fill:var(--ink);
}
/* An open ring: a faint boundary round its members, and the mark a reader clicks to close it. */
.node-boundary{
  fill:none;
  stroke:var(--rule);
  stroke-width:1;
  stroke-dasharray:2 5;
  stroke-linecap:round;
}
.node--opened:hover .node-boundary{stroke:var(--ink-soft);}
.node-fill--opened{fill:var(--paper);stroke:var(--rule);stroke-width:1;}
.node-count--opened{font-size:12px;fill:var(--ink-soft);}
.node-member{fill:var(--paper-lift);stroke:var(--external);stroke-width:2;}
.node--internal .node-member{stroke:var(--internal);}
/* A member nobody has identified is drawn, and drawn dashed. Hiding it because it has no name
   to show would be the one thing the open ring must not do. */
.node-member--open{stroke-dasharray:3 4;opacity:.8;}
.node:hover .node-fill{fill:var(--paper);}
.node:hover .node-arc{stroke-width:3.5;}
.dim{opacity:.16;}

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
.detail-place-name{margin:0;font-size:16px;font-weight:500;letter-spacing:-.01em;}
.detail-facts{
  margin:12px 0 0;
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px 12px;
}
.detail-facts>div{min-width:0;}
.detail-facts dt{
  margin:0;
  font-size:9px;
  font-weight:600;
  letter-spacing:.1em;
  text-transform:uppercase;
  color:var(--ink-soft);
}
.detail-facts dd{margin:3px 0 0;font-size:13px;line-height:1.35;}
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

/* Under every fact: how it is known, and from what. Quiet, because it is the footnote to the
   fact and not the fact. */
.detail-said-by{
  margin:2px 0 0;
  font-family:var(--mono);
  font-size:9px;
  letter-spacing:.02em;
  color:var(--ink-soft);
}
.detail-facts dd.detail-said-by{margin:1px 0 0;}
.detail-totals{margin:10px 0 0;font-family:var(--mono);font-size:10px;color:var(--ink-soft);}

/* Everything nobody has answered, in one line that opens. Closed, it is a count; open, it is the
   same questions the printed gaps sheet asks. */
.detail-unknowns{margin:14px 0 0;}
.detail-unknowns summary{
  cursor:pointer;
  font-size:11.5px;
  color:var(--ink-soft);
  letter-spacing:.02em;
}
.detail-unknowns ul{list-style:none;margin:8px 0 0;padding:0 0 0 12px;border-left:2px solid var(--rule);}
.detail-unknowns li{margin:0 0 6px;font-size:11.5px;line-height:1.4;color:var(--ink);}

/* The panel speaks the map's colour language: a door referenced here carries its door chip. */
.detail-reached{display:flex;align-items:center;gap:5px;margin:12px 0 0;}
.detail-reached-label{
  font-family:var(--mono);
  font-size:9px;
  letter-spacing:.02em;
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
.detail-observations li{margin:0 0 5px;font-family:var(--mono);font-size:11px;}

/* The map settles rather than appears: rings first, then what sits on them. A scan is the one
   moment this tool has to show something happening, and a drawing that arrives all at once
   reads as a picture instead of a reading. */
@keyframes fade-in{from{opacity:0;}to{opacity:inherit;}}
@keyframes settle{from{opacity:0;transform:scale(.9);}to{opacity:1;transform:scale(1);}}
.path{animation:fade-in .4s ease-out both;}
.node,.subject,.door,.controller{
  animation:settle .32s ease-out both;
  transform-box:fill-box;
  transform-origin:center;
}

@media (prefers-reduced-motion:reduce){
  .path,.node,.subject,.door,.controller{animation:none;}
}

@media (max-width:900px){
  .sheet{display:block;height:auto;}
  .detail{width:auto;border-left:0;border-top:1px solid var(--rule);padding:20px 24px 24px;}
  .map-svg{height:auto;}
}
@media (max-width:680px){
  .legend{grid-template-columns:repeat(2,minmax(0,1fr));}
}

/* The limits statement and the possible-gaps line: real text in the DOM at all times, so what
   prints can never drift from what the app knows, but of no use on this screen. print.css
   turns it back on inside @media print. */
.print-only{display:none;}
`
