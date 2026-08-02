/**
 * The sheet: tokens and the one stylesheet.
 *
 * Held as a string rather than a .css file so nothing has to be added to the build or to
 * tsconfig, and injected as a single <style> element, which the renderer's CSP allows
 * (`style-src 'self' 'unsafe-inline'`). No font is fetched or bundled: system stacks only.
 *
 * The notation the whole interface is built from, and the reason each token exists:
 *
 *   solid stroke      a fact somebody recorded
 *   dashed stroke     an open item -- nobody has answered it yet
 *   break mark        the data crosses out of the EEA
 *   filled disc       people, the origin of every line
 *   filled cells      how soon a question is worth answering
 *
 * Colour is used once, for people, and never for anything that could be read as a fault. Every
 * distinction above survives greyscale, because it is carried by line style and shape; the one
 * hue only reinforces the thing it marks.
 *
 * Print is the one exception to "held as a string": `./print.css` is an ordinary stylesheet, so
 * Vite bundles it rather than this file having to grow a second string nobody can lint. This
 * import is the only thing that makes it reach the page.
 */
import './print.css'

export const STYLESHEET = `
:root{
  --sheet:#EEEFF1;
  --ink:#15171C;
  --ink-soft:#5A5F69;
  --rule:#C4C8CF;
  --person:#2A3D8F;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
  --serif:Georgia,"Times New Roman","Liberation Serif",serif;
}

/* One field, one dividing rule: the map and the register are two regions of the same sheet,
   not two panels. */
.sheet{
  display:flex;
  height:100vh;
  background:var(--sheet);
  color:var(--ink);
  font-family:var(--serif);
  -webkit-font-smoothing:antialiased;
}
.plate{
  display:flex;
  flex-direction:column;
  flex:1;
  min-width:0;
  min-height:0;
  padding:0 22px 18px;
}

:focus-visible{outline:2px solid var(--ink);outline-offset:2px;}

/* Title block. A sheet a consultant leaves behind has to say what it is and when it was begun. */
.titleblock{
  display:flex;
  align-items:baseline;
  gap:14px;
  padding:16px 0 10px;
  border-bottom:1px solid var(--rule);
}
.wordmark{font-family:var(--mono);font-size:10px;letter-spacing:.28em;text-transform:uppercase;}
.project{font-size:15px;font-weight:400;margin:0;min-width:0;}
.drawn{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;color:var(--ink-soft);}
.actions{margin-left:auto;display:flex;gap:6px;}
.action{
  font-family:var(--mono);
  font-size:9.5px;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:var(--ink);
  background:none;
  border:1px solid var(--ink);
  border-radius:0;
  padding:5px 9px;
  cursor:pointer;
}
.action:hover:enabled{background:var(--ink);color:var(--sheet);}
.action:disabled{border-color:var(--rule);color:var(--ink-soft);cursor:default;}

/* The scan control: a plain field and one button, styled like the title-block actions it sits
   beside rather than as a form of its own. */
.scanbar{display:flex;gap:6px;padding:10px 0 0;}
.scan-input{
  flex:1;
  min-width:0;
  font-family:var(--mono);
  font-size:11px;
  color:var(--ink);
  background:none;
  border:1px solid var(--rule);
  border-radius:0;
  padding:6px 9px;
}
.scan-input:disabled{color:var(--ink-soft);}
.scan-input:focus-visible{outline:2px solid var(--ink);outline-offset:1px;}

/* A message about this session, not about the client's data: heavier left rule, no colour. */
.notice{
  display:flex;
  gap:14px;
  justify-content:space-between;
  align-items:baseline;
  margin:12px 0 0;
  padding:9px 12px;
  border:1px solid var(--ink);
  border-left-width:3px;
  font-size:12.5px;
  line-height:1.4;
}

/* The map */
.map{flex:1;display:flex;flex-direction:column;min-height:0;margin:0;}
.map-svg{flex:1;min-height:0;width:100%;height:100%;display:block;}
.map-empty{
  margin:0;
  padding:11px 0 0;
  border-top:1px solid var(--rule);
  font-size:12px;
  color:var(--ink-soft);
}

.link{stroke:var(--ink);stroke-width:1;fill:none;}
.crossing{stroke:var(--ink);stroke-width:1.25;fill:none;}
.disc{fill:var(--person);}
.disc-label{
  fill:var(--sheet);
  font-family:var(--mono);
  font-size:11px;
  letter-spacing:.16em;
}
.disc-count{fill:var(--sheet);font-family:var(--mono);font-size:8.5px;}
.tile{cursor:pointer;}
/* The tile is filled with the sheet so a connector stops cleanly at its edge. The fill is
   masking, not decoration, which is why it is exactly the background. */
.tile-box{fill:var(--sheet);stroke:var(--ink);stroke-width:1;}
.tile:hover .tile-box{stroke-width:2;}
.tile-name{font-family:var(--mono);font-size:9px;letter-spacing:.06em;fill:var(--ink);}
.tile-count{font-family:var(--mono);font-size:9px;fill:var(--ink-soft);}
.tile-div{stroke:var(--rule);stroke-width:1;}
.tile-row{font-family:var(--mono);font-size:8.5px;fill:var(--ink);}
.cell{fill:none;stroke:var(--ink);stroke-width:1;}
.cell--open{stroke-dasharray:2.5 2;}
.cell-figure{font-family:var(--mono);font-size:8.5px;fill:var(--ink);}
.dim{opacity:.22;}

/* The key. The notation is not common knowledge, and the sheet is read by someone seeing it
   for the first time, often on paper. */
.legend{
  margin:0;
  padding:11px 0 0;
  border-top:1px solid var(--rule);
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:14px;
}
.key{display:flex;gap:9px;align-items:flex-start;}
.key-mark{flex:none;margin-top:1px;}
.key-term{
  display:block;
  font-family:var(--mono);
  font-size:9px;
  letter-spacing:.11em;
  text-transform:uppercase;
}
.key-gloss{display:block;margin:2px 0 0;font-size:11px;line-height:1.35;color:var(--ink-soft);}

/* The register */
.register{
  width:322px;
  flex:none;
  border-left:1px solid var(--rule);
  padding:16px 22px 18px;
  overflow-y:auto;
}
.register-head{
  display:flex;
  align-items:baseline;
  gap:8px;
  margin:0;
  font-family:var(--mono);
  font-size:10px;
  font-weight:400;
  letter-spacing:.16em;
  text-transform:uppercase;
}
.register-count{margin-left:auto;font-size:12px;letter-spacing:0;}
.register-caption,.register-empty{
  margin:9px 0 0;
  font-size:11.5px;
  line-height:1.45;
  color:var(--ink-soft);
}
.register-list{list-style:none;margin:14px 0 0;padding:0;border-top:1px solid var(--rule);}
/* Dashed separators, for the same reason the map dashes an unanswered count: every line in
   this list is still open. */
.entry{
  display:grid;
  grid-template-columns:26px 1fr;
  column-gap:10px;
  padding:11px 0;
  border-bottom:1px dashed var(--rule);
  border-left:3px solid transparent;
  padding-left:7px;
  margin-left:-10px;
}
.entry--linked{cursor:pointer;}
.entry--linked:hover,.entry--linked:focus-visible{border-left-color:var(--ink);}
.entry-gauge{margin-top:3px;}
.gauge-cell{fill:none;stroke:var(--ink);stroke-width:1;}
.gauge-cell--on{fill:var(--ink);}
.entry-q{margin:0;font-size:13px;line-height:1.4;}
.entry-why{margin:3px 0 0;font-size:11.5px;line-height:1.45;color:var(--ink-soft);}

@media (max-width:900px){
  .sheet{display:block;height:auto;}
  .register{width:auto;border-left:0;border-top:1px solid var(--rule);padding:16px 22px 22px;}
  .map-svg{height:auto;}
}
@media (max-width:620px){
  .legend{grid-template-columns:repeat(2,minmax(0,1fr));}
}

/* The limits statement and the possible-gaps line: real text in the DOM at all times, so what
   prints can never drift from what the app knows, but of no use on this screen. print.css turns
   it back on inside @media print. */
.print-only{display:none;}
`
