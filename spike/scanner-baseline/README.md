# scanner-baseline

Measurement harness for `docs/decisions/2026-09-29-scanner-baseline.md`. Ships zero bytes.

- `scanrun/` — runs the app's real scanner (`traccia_lib::scan::run`) on one URL, prints its JSON.
- `reference.mjs` — independent observer: fresh headless Chrome over CDP, all traffic allowed,
  pre-consent, accept click, key pages.
- `batch.mjs` — both passes over every site in `$DATA/sites.tsv`, 3 at a time, resumable.
- `compare.mjs` — per-site and aggregate comparison, writes `$DATA/compare.json`.

```
(cd scanrun && cargo build --release)
DATA=~/Documents/Claude/traccia-fixtures/scanner-baseline-2026-09-29 node batch.mjs
DATA=... node compare.mjs "$(git rev-parse --show-toplevel)"
```

`DATA` stays outside the repo: the site list names real organisations. To re-measure after a change,
point `DATA` at a new directory holding the same `sites.tsv`.
