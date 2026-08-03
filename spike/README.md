# spike

Throwaway experiments, kept because the decisions they settled are load-bearing and the evidence
should outlive the argument. Nothing here is built, shipped, or imported by the app.

- `cdp-driver/` — a minimal Chrome DevTools Protocol driver, written to find out whether a scan
  could be done by driving a browser the user already has rather than bundling one. It could.
  Findings: [`docs/decisions/2026-07-31-cdp-spike-findings.md`](../docs/decisions/2026-07-31-cdp-spike-findings.md),
  and the attempt to break the result:
  [`2026-07-31-cdp-spike-falsification.md`](../docs/decisions/2026-07-31-cdp-spike-falsification.md).
- `oracle.mjs` — a reference implementation used to check the driver's output against a second,
  independently written one.
