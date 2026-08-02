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
.scanbar{display:flex;gap:7px;padding:14px 0 0;}
.scan-input{
  flex:1;
  min-width:0;
  font-family:var(--mono);
  font-size:12px;
  color:var(--ink);
  background:var(--paper-lift);
  border:1px solid var(--rule);
  border-radius:999px;
  padding:8px 15px;
}
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

.orbit{fill:none;stroke:var(--rule);stroke-width:1;stroke-dasharray:1 5;stroke-linecap:round;}
.link{stroke:var(--rule);stroke-width:1.25;fill:none;}
.link--internal{stroke:var(--internal);opacity:.5;}
.link--external{stroke:var(--external);opacity:.5;}
.crossing{stroke:var(--crossing);stroke-width:2;stroke-linecap:round;fill:none;}

.subject{cursor:pointer;}
.disc{fill:var(--person);}
.disc-halo{fill:none;stroke:var(--person);stroke-width:1;opacity:.28;}
.disc-label{
  fill:var(--paper);
  font-size:12px;
  font-weight:600;
  letter-spacing:.2em;
}
.disc-count{fill:var(--paper);font-family:var(--mono);font-size:9px;opacity:.85;}

.node{cursor:pointer;}
.node-fill{fill:var(--paper-lift);}
.node-arc{fill:none;stroke-width:2.5;stroke-linecap:butt;}
.node--internal .node-arc{stroke:var(--internal);}
.node--external .node-arc{stroke:var(--external);}
.node-arc--open{stroke-dasharray:3 4;opacity:.75;}
.node-count{font-size:17px;font-weight:500;fill:var(--ink);}
.node-label{
  font-size:10.5px;
  font-weight:500;
  letter-spacing:.05em;
  fill:var(--ink);
}
.node-eea{font-family:var(--mono);font-size:8.5px;fill:var(--crossing);letter-spacing:.02em;}
.node:hover .node-fill{fill:var(--paper);}
.node:hover .node-arc{stroke-width:3.5;}
.dim{opacity:.16;}

/* The key. The notation is not common knowledge, and the sheet is read by someone seeing it
   for the first time, often on paper. */
.legend{
  margin:0;
  padding:13px 0 0;
  border-top:1px solid var(--rule);
  display:grid;
  grid-template-columns:repeat(5,minmax(0,1fr));
  gap:16px;
}
.key{display:flex;gap:9px;align-items:flex-start;}
.key-mark{flex:none;margin-top:1px;}
.key-term{display:block;font-size:10.5px;font-weight:600;letter-spacing:.02em;}
.key-gloss{display:block;margin:1px 0 0;font-size:10.5px;line-height:1.35;color:var(--ink-soft);}

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
  width:338px;
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
.detail-declared{margin:10px 0 0;font-family:var(--mono);font-size:9.5px;color:var(--ink-soft);}
.detail-observations{list-style:none;margin:9px 0 0;padding:0;}
.detail-observations li{margin:0 0 5px;font-family:var(--mono);font-size:11px;}

/* The map settles rather than appears: rings first, then what sits on them. A scan is the one
   moment this tool has to show something happening, and a drawing that arrives all at once
   reads as a picture instead of a reading. */
@keyframes trace-in{from{stroke-dashoffset:var(--dash);}to{stroke-dashoffset:0;}}
@keyframes settle{from{opacity:0;transform:scale(.9);}to{opacity:1;transform:scale(1);}}
.link{stroke-dasharray:var(--dash);animation:trace-in .5s ease-out both;}
.node,.subject{animation:settle .32s ease-out both;transform-box:fill-box;transform-origin:center;}

@media (prefers-reduced-motion:reduce){
  .link,.node,.subject{animation:none;stroke-dashoffset:0;}
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
