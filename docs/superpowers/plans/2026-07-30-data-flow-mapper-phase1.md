# Data Flow Mapper — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of a local-only desktop app that maps where an organisation's personal data goes — the project file, the pure map model, gap computation, deterministic layout, and a working Electron shell that renders the map and its register of unanswered questions.

**Architecture:** A pure TypeScript core (`src/core`) holds all business rules and touches no I/O, so it is fully unit-testable. The Electron main process owns the filesystem and the network boundary. The React renderer draws SVG from a layout the core computes and holds no business state. Data flows one way: core computes, main persists, renderer draws.

**Tech Stack:** Electron 33+, TypeScript 5.6+, React 18, Vite (via electron-vite), Vitest, hand-written SVG (no charting library).

**Spec:** `docs/superpowers/specs/2026-07-30-data-flow-mapper-design.md` — read it before Task 1.

## Global Constraints

- **No outbound network traffic** except requests to a URL the user explicitly entered for a scan. No telemetry, no crash reporting, no update check, no CDN for fonts or assets. Everything is bundled.
- **The core is pure.** Nothing under `src/core/` may import `fs`, `path`, or `electron`, or perform I/O. Every core function takes inputs and returns new values.
- **No non-determinism in the core.** No `Date.now()`, no `Math.random()`, no `crypto.randomUUID()` inside `src/core/`. Timestamps and IDs are passed in as parameters by callers. This is what makes the tests exact.
- **Gaps are computed, never stored.** No gap is ever written to the project file or edited by a user.
- **A Place belongs to exactly one purpose group.** `leavesEEA` and gap counts are properties, never groups.
- **`schemaVersion` is present in the project file from the first commit.** Current value: `1`.
- **Unknowns are neutral in all copy.** Write "not yet identified", never "violation", "risk", "breach", or "non-compliant".
- **TypeScript `strict: true`.** No `any` in `src/core/`.
- **Node 20+.**
- **Platforms: macOS and Windows.** Not Linux. Anything touching the filesystem must work on both — in
  particular, see the Windows retry rule in Task 12.
- **English only, strings in one module.** Every user-facing string lives in `src/renderer/strings.ts`
  and is imported from there. No string literals in components. This costs nothing now and makes a
  later Italian translation a translation rather than a refactor.
- **Dependency licences must permit commercial and closed-source use** — MIT, Apache-2.0, BSD, ISC or
  equivalent. No copyleft. The project's own licence is undecided, so nothing may foreclose it.
- **Distribution is free via GitHub releases, unsigned in v1.** No update check, no licence key, no
  account.

## Phase roadmap

This plan is Phase 1. Later phases each get their own plan and build on the interfaces established here.

| Phase | Delivers | Depends on |
|---|---|---|
| **1 (this plan)** | Project file, core model, gap computation, layout, Electron shell, map and register UI | — |
| 2 | Website scanner: hidden `BrowserWindow`, request capture, pre/post consent | Phase 1 `Observation` type and `mergeObservations` |
| 3 | Document reader: PDF/DOCX/XLSX/CSV extraction, vendor dictionary | Phase 1 `SourceRef` and place mutations |
| 4 | Export (PDF/PNG plus gap list), project file encryption | Phase 1 layout and register |

---

## File structure

```
src/
  core/                     PURE. No I/O, no Electron, no Date.now, no Math.random.
    types.ts                All entity types and the Project shape.
    project.ts              createEmptyProject, validateProject.
    graph.ts                Place and Flow mutations. Referential integrity.
    merge.ts                Folding scan observations into the graph.
    expectations.ts         The twelve expected business functions.
    gaps/
      attribute.ts          Empty-field gaps.
      existence.ts          Expected-but-absent gaps.
      contradiction.ts      Sources disagree.
      index.ts              computeGaps orchestrator and ranking.
    layout.ts               Deterministic radial layout.
  main/                     Electron main process. Owns filesystem and network.
    index.ts                App lifecycle, window creation.
    egressGuard.ts          Blocks all non-scan network requests.
    projectFile.ts          Atomic read/write of the project JSON.
    ipc.ts                  IPC handlers.
  preload/
    index.ts                contextBridge surface.
  renderer/
    main.tsx                React entry.
    App.tsx                 Top-level state, wires IPC to components.
    components/
      MapView.tsx           SVG map from a LayoutResult.
      RegisterPanel.tsx     Ranked gap list, linked to the map.
tests/
  core/                     Mirrors src/core, one file per module.
  main/
    egressGuard.test.ts     The security-critical suite.
    projectFile.test.ts
  fixtures/
    projects.ts             Shared fixture projects for gap tests.
.claude/
  agents/
    coder.md
    reviewer.md
    security-auditor.md
CLAUDE.md
```

---

## Agent orchestration

Three project agents, defined in Task 1. Every task runs through the same loop.

**The loop, per task:**

1. **coder** implements the task, following its steps exactly. TDD: test first, watch it fail, minimal implementation, watch it pass.
2. **reviewer** reviews the diff against the task's stated deliverable and the Global Constraints. Returns blocking findings and advisory findings.
3. **security-auditor** runs **only** on tasks marked `SECURITY GATE` — those touching the network boundary, the filesystem, IPC, or the preload bridge. It has authority to block a commit.
4. coder fixes blocking findings. Advisory findings are recorded in the commit body, not necessarily fixed.
5. Commit. Move to the next task.

**Tasks marked SECURITY GATE:** 11, 12, 13.

The auditor's standing brief, in priority order: prove no network egress can occur outside a scan; prove the preload bridge exposes no arbitrary filesystem or shell access to the renderer; prove project file writes cannot destroy user data on a crash; confirm no user data reaches a log, a temp file that outlives the process, or a third-party dependency's telemetry.

---

## Task 1: Scaffold, agents, and a green test run

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `.claude/agents/coder.md`, `.claude/agents/reviewer.md`, `.claude/agents/security-auditor.md`
- Create: `CLAUDE.md`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs Vitest; three agents available to the orchestrator.

- [ ] **Step 1: Initialise the repository**

```bash
mkdir -p traccia && cd traccia
git init
npm init -y
npm i -D typescript vitest electron electron-vite @vitejs/plugin-react @types/node @types/react @types/react-dom
npm i react react-dom
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
})
```

- [ ] **Step 4: Add scripts to `package.json`**

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "dev": "electron-vite dev",
    "build": "electron-vite build"
  }
}
```

- [ ] **Step 5: Write the smoke test**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs typescript under vitest', () => {
    const n: number = 1 + 1
    expect(n).toBe(2)
  })
})
```

- [ ] **Step 6: Run it**

Run: `npm test`
Expected: PASS, 1 test. If Vitest cannot resolve TypeScript, the `tsconfig.json` from Step 2 is missing or malformed — fix that before continuing.

- [ ] **Step 7: Write `.claude/agents/coder.md`**

```markdown
---
name: coder
description: Implements one task from the Phase 1 plan. Writes the test first, watches it fail, writes the minimal implementation, watches it pass. Never skips ahead to a later task.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You implement exactly one task from `docs/superpowers/plans/2026-07-30-data-flow-mapper-phase1.md`.

Rules:
- Follow the task's steps in order. Do not reorder, merge, or skip them.
- Write the test first and run it to confirm it fails for the stated reason. A test that passes
  before the implementation exists is a broken test — fix the test, do not proceed.
- Write the minimal code that makes the test pass. No speculative generality, no extra options,
  no "while I'm here" refactors.
- Read the Global Constraints section of the plan before writing any code. They apply to every task.
- `src/core/` must stay pure: no `fs`, no `path`, no `electron`, no `Date.now()`, no `Math.random()`.
  If a task seems to need one, you have misread the task — timestamps and IDs are parameters.
- If a step's code conflicts with something you built in an earlier task, stop and report the
  conflict rather than silently choosing one. Report the exact signatures on both sides.
- Do not commit. The orchestrator commits after review.
```

- [ ] **Step 8: Write `.claude/agents/reviewer.md`**

```markdown
---
name: reviewer
description: Reviews the diff for one completed task against its stated deliverable and the plan's Global Constraints. Returns blocking and advisory findings. Reads only; never edits.
tools: Read, Grep, Glob, Bash
---

You review the diff for one completed task. You do not edit code.

Check, in this order:

1. **Does it do what the task said?** Compare the diff against the task's Files and Interfaces
   blocks. A function named differently from the Interfaces block is a blocking finding — later
   tasks were written against those exact names.
2. **Global Constraints.** Purity of `src/core/`, no non-determinism, strict types, no `any` in
   core, neutral copy for unknowns.
3. **Test quality.** Does the test exercise the behaviour, or does it assert a restatement of the
   implementation? Would it still fail if the implementation were wrong in a plausible way? A test
   that only checks "does not throw" is a blocking finding.
4. **Simplification.** Anything the task did not ask for: unused parameters, premature abstraction,
   options nobody passes.

Return two lists. **Blocking** — must be fixed before commit. **Advisory** — worth noting, not worth
stopping for. If both are empty, say so in one line. Do not pad the review.
```

- [ ] **Step 9: Write `.claude/agents/security-auditor.md`**

```markdown
---
name: security-auditor
description: Audits tasks that touch the network boundary, the filesystem, IPC, or the preload bridge. Has authority to block a commit. Reads only; never edits.
tools: Read, Grep, Glob, Bash
---

You audit one completed task. You do not edit code. You may block a commit.

This product's central promise is that a map of the user's data flows never leaves their machine. A
defect here is fatal to the product, so treat any doubt as a finding.

Audit in this priority order:

1. **Egress.** Can any network request occur that is not addressed to a URL the user explicitly
   entered for a scan? Check for fetch/XHR/WebSocket in any process, `<link>` or `@import` to a
   remote host, remote fonts, remote images, source maps pointing at a CDN, dependency install
   scripts, update checkers, and any analytics or crash reporter added transitively. Run
   `grep -rEn "https?://" src/` and account for every hit.
2. **Preload surface.** Does `contextBridge` expose anything that lets the renderer read or write an
   arbitrary path, spawn a process, or evaluate a string? The renderer must only be able to ask for
   actions the main process fully validates. `nodeIntegration` must be off and `contextIsolation` on.
3. **File writes.** Can a crash mid-write destroy the user's project? Writes must go to a temp file
   in the same directory and then rename. Check the temp file is cleaned up on failure.
4. **Leakage.** Does any user data reach a log line, an error message shown outside the app, a temp
   file that outlives the process, or a third party?

Return **BLOCK** with specific findings, or **PASS** with any advisory notes. State exactly what you
checked, so the next auditor does not repeat the work.
```

- [ ] **Step 10: Write `CLAUDE.md`**

```markdown
# Traccia — working notes for Claude

Local-only desktop app that maps where an organisation's personal data goes.

**Spec:** `docs/superpowers/specs/2026-07-30-data-flow-mapper-design.md`
**Plan:** `docs/superpowers/plans/2026-07-30-data-flow-mapper-phase1.md`

## Non-negotiables

- No outbound network traffic except a scan of a URL the user explicitly entered. No telemetry, no
  crash reporting, no update check, no CDN. Everything bundled.
- `src/core/` is pure: no `fs`, no `path`, no `electron`, no `Date.now()`, no `Math.random()`.
  Timestamps and IDs are parameters.
- Gaps are computed on demand, never stored in the project file, never edited by a user.
- Copy about unknowns stays neutral: "not yet identified", never "violation" or "non-compliant".

## Commands

- `npm test` — Vitest, all suites
- `npm run typecheck` — tsc, no emit
- `npm run dev` — Electron in development

## Working method

One task at a time from the plan. coder implements, reviewer reviews, security-auditor gates any task
touching network, filesystem, IPC or preload. Commit after review passes.
```

- [ ] **Step 11: Write `.gitignore`**

```
node_modules/
out/
dist/
.DS_Store
*.local
```

- [ ] **Step 12: Verify and commit**

Run: `npm test && npm run typecheck`
Expected: 1 test passes, no type errors.

```bash
git add -A
git commit -m "chore: scaffold electron+ts+vitest, add project agents and CLAUDE.md"
```

---

## Task 2: Core types and the empty project

**Files:**
- Create: `src/core/types.ts`, `src/core/project.ts`
- Test: `tests/core/project.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Types `Confidence`, `Holder`, `PlaceKind`, `GapKind`, `Tri`, `SourceRef`, `SubjectGroup`, `Place`, `Flow`, `Gap`, `Observation`, `Project`
  - `DEFAULT_PURPOSE_GROUPS: readonly string[]`
  - `createEmptyProject(name: string, createdAt: string): Project`

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/project.test.ts
import { describe, it, expect } from 'vitest'
import { createEmptyProject, DEFAULT_PURPOSE_GROUPS } from '../../src/core/project'

describe('createEmptyProject', () => {
  it('stamps schemaVersion 1 and the supplied timestamp', () => {
    const p = createEmptyProject('Rossi Editore', '2026-07-30T09:00:00.000Z')
    expect(p.schemaVersion).toBe(1)
    expect(p.name).toBe('Rossi Editore')
    expect(p.createdAt).toBe('2026-07-30T09:00:00.000Z')
  })

  it('starts with the default purpose groups and nothing else', () => {
    const p = createEmptyProject('X', '2026-07-30T09:00:00.000Z')
    expect(p.purposeGroups).toEqual([...DEFAULT_PURPOSE_GROUPS])
    expect(p.places).toEqual([])
    expect(p.flows).toEqual([])
    expect(p.subjectGroups).toEqual([])
    expect(p.observations).toEqual([])
  })

  it('returns an independent object each call', () => {
    const a = createEmptyProject('A', '2026-07-30T09:00:00.000Z')
    const b = createEmptyProject('B', '2026-07-30T09:00:00.000Z')
    a.places.push({
      id: 'p1', name: 'X', kind: 'internal', purposeGroup: 'Selling',
      holder: 'you', leavesEEA: false, sources: [], confidence: 'declared',
    })
    expect(b.places).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/project.test.ts`
Expected: FAIL — cannot resolve `../../src/core/project`.

- [ ] **Step 3: Write `src/core/types.ts`**

```ts
export type Confidence = 'observed' | 'declared' | 'inferred'
export type Holder = 'you' | 'supplier' | 'unknown'
export type PlaceKind = 'collection' | 'internal' | 'processor' | 'unknown'
export type GapKind = 'attribute' | 'existence' | 'contradiction'

/** Three-state boolean. `'unknown'` is a real answer, not a missing one. */
export type Tri = boolean | 'unknown'

export interface SourceRef {
  documentId: string
  documentName: string
  locator?: string
}

export interface SubjectGroup {
  id: string
  name: string
  estimatedCount?: number
  notes?: string
}

export interface Place {
  id: string
  name: string
  kind: PlaceKind
  purposeGroup: string
  holder: Holder
  jurisdiction?: string
  leavesEEA: Tri
  retention?: string
  sources: SourceRef[]
  confidence: Confidence
}

export interface Flow {
  id: string
  /** A Place id or a SubjectGroup id. */
  from: string
  /** A Place id. */
  to: string
  dataDescription: string
  purpose: string
  sources: SourceRef[]
  confidence: Confidence
}

export interface Gap {
  id: string
  kind: GapKind
  /** Place id, Flow id, or null for gaps about the project as a whole. */
  subject: string | null
  question: string
  why: string
  severity: 1 | 2 | 3
}

/** One third-party domain seen during a scan. Produced in Phase 2. */
export interface Observation {
  domain: string
  requestCount: number
  beforeConsent: boolean
}

export interface Project {
  schemaVersion: 1
  name: string
  createdAt: string
  purposeGroups: string[]
  subjectGroups: SubjectGroup[]
  places: Place[]
  flows: Flow[]
  observations: Observation[]
}
```

- [ ] **Step 4: Write `src/core/project.ts`**

```ts
import type { Project } from './types'

export const DEFAULT_PURPOSE_GROUPS = [
  'Selling',
  'Marketing',
  'Support',
  'Employing people',
  'Getting paid',
  'Running the systems',
  'Delivering orders',
] as const

export function createEmptyProject(name: string, createdAt: string): Project {
  return {
    schemaVersion: 1,
    name,
    createdAt,
    purposeGroups: [...DEFAULT_PURPOSE_GROUPS],
    subjectGroups: [],
    places: [],
    flows: [],
    observations: [],
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/core/project.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/project.ts tests/core/project.test.ts
git commit -m "feat(core): entity types and empty project constructor"
```

---

## Task 3: Project validation

**Files:**
- Modify: `src/core/project.ts`
- Test: `tests/core/validate.test.ts`

**Interfaces:**
- Consumes: `Project` from Task 2.
- Produces: `validateProject(value: unknown): ValidationResult`, where
  `type ValidationResult = { ok: true; project: Project } | { ok: false; errors: string[] }`

Validation exists because the project file is a plain JSON document a user can edit or corrupt. Loading garbage must produce a clear message, never a crash halfway through rendering.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/validate.test.ts
import { describe, it, expect } from 'vitest'
import { createEmptyProject, validateProject } from '../../src/core/project'

const NOW = '2026-07-30T09:00:00.000Z'

describe('validateProject', () => {
  it('accepts a project it just created', () => {
    const r = validateProject(createEmptyProject('X', NOW))
    expect(r.ok).toBe(true)
  })

  it('rejects a non-object', () => {
    const r = validateProject('not a project')
    expect(r).toEqual({ ok: false, errors: ['Project must be an object.'] })
  })

  it('rejects an unsupported schemaVersion with a readable message', () => {
    const r = validateProject({ ...createEmptyProject('X', NOW), schemaVersion: 99 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toContain(
        'Unsupported schemaVersion: 99. This file needs a newer version of the app.',
      )
    }
  })

  it('reports every missing array rather than only the first', () => {
    const r = validateProject({ schemaVersion: 1, name: 'X', createdAt: NOW })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toContain('purposeGroups must be an array.')
      expect(r.errors).toContain('places must be an array.')
      expect(r.errors).toContain('flows must be an array.')
    }
  })

  it('rejects a flow pointing at a place that does not exist', () => {
    const p = createEmptyProject('X', NOW)
    p.flows.push({
      id: 'f1', from: 'missing-a', to: 'missing-b',
      dataDescription: 'd', purpose: 'p', sources: [], confidence: 'declared',
    })
    const r = validateProject(p)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('Flow f1 refers to unknown id: missing-a')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/validate.test.ts`
Expected: FAIL — `validateProject` is not exported.

- [ ] **Step 3: Add `validateProject` to `src/core/project.ts`**

```ts
export type ValidationResult =
  | { ok: true; project: Project }
  | { ok: false; errors: string[] }

export function validateProject(value: unknown): ValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['Project must be an object.'] }
  }
  const v = value as Record<string, unknown>
  const errors: string[] = []

  if (v.schemaVersion !== 1) {
    errors.push(
      `Unsupported schemaVersion: ${String(v.schemaVersion)}. This file needs a newer version of the app.`,
    )
  }
  if (typeof v.name !== 'string') errors.push('name must be a string.')
  if (typeof v.createdAt !== 'string') errors.push('createdAt must be a string.')

  for (const key of ['purposeGroups', 'subjectGroups', 'places', 'flows', 'observations']) {
    if (!Array.isArray(v[key])) errors.push(`${key} must be an array.`)
  }

  if (errors.length === 0) {
    const p = value as Project
    const ids = new Set<string>([
      ...p.places.map((x) => x.id),
      ...p.subjectGroups.map((x) => x.id),
    ])
    for (const f of p.flows) {
      if (!ids.has(f.from)) errors.push(`Flow ${f.id} refers to unknown id: ${f.from}`)
      if (!ids.has(f.to)) errors.push(`Flow ${f.id} refers to unknown id: ${f.to}`)
    }
  }

  return errors.length === 0
    ? { ok: true, project: value as Project }
    : { ok: false, errors }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/core/validate.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/project.ts tests/core/validate.test.ts
git commit -m "feat(core): validate project files with readable errors"
```

---

## Task 4: Place mutations

**Files:**
- Create: `src/core/graph.ts`
- Test: `tests/core/graph-places.test.ts`

**Interfaces:**
- Consumes: `Project`, `Place` from Task 2.
- Produces:
  - `addPlace(project: Project, place: Omit<Place, 'id'>, id: string): Project`
  - `updatePlace(project: Project, id: string, patch: Partial<Omit<Place, 'id'>>): Project`
  - `removePlace(project: Project, id: string): Project`

Every function returns a new `Project`. The `id` is a parameter, not generated, because the core is deterministic.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/graph-places.test.ts
import { describe, it, expect } from 'vitest'
import { createEmptyProject } from '../../src/core/project'
import { addPlace, updatePlace, removePlace } from '../../src/core/graph'
import type { Place } from '../../src/core/types'

const NOW = '2026-07-30T09:00:00.000Z'
const draft: Omit<Place, 'id'> = {
  name: 'Newsletter', kind: 'processor', purposeGroup: 'Marketing',
  holder: 'supplier', leavesEEA: false, sources: [], confidence: 'declared',
}

describe('place mutations', () => {
  it('adds a place with the supplied id', () => {
    const p = addPlace(createEmptyProject('X', NOW), draft, 'pl-1')
    expect(p.places).toHaveLength(1)
    expect(p.places[0]?.id).toBe('pl-1')
    expect(p.places[0]?.name).toBe('Newsletter')
  })

  it('does not mutate the project passed in', () => {
    const before = createEmptyProject('X', NOW)
    addPlace(before, draft, 'pl-1')
    expect(before.places).toEqual([])
  })

  it('rejects a duplicate id', () => {
    const p = addPlace(createEmptyProject('X', NOW), draft, 'pl-1')
    expect(() => addPlace(p, draft, 'pl-1')).toThrow('Place id already exists: pl-1')
  })

  it('applies a patch and leaves other fields alone', () => {
    let p = addPlace(createEmptyProject('X', NOW), draft, 'pl-1')
    p = updatePlace(p, 'pl-1', { retention: '2 years', confidence: 'observed' })
    expect(p.places[0]?.retention).toBe('2 years')
    expect(p.places[0]?.confidence).toBe('observed')
    expect(p.places[0]?.name).toBe('Newsletter')
  })

  it('throws when updating a place that does not exist', () => {
    const p = createEmptyProject('X', NOW)
    expect(() => updatePlace(p, 'nope', { retention: '1 year' })).toThrow('No such place: nope')
  })

  it('removes a place', () => {
    let p = addPlace(createEmptyProject('X', NOW), draft, 'pl-1')
    p = removePlace(p, 'pl-1')
    expect(p.places).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/graph-places.test.ts`
Expected: FAIL — cannot resolve `../../src/core/graph`.

- [ ] **Step 3: Write `src/core/graph.ts`**

```ts
import type { Place, Project } from './types'

export function addPlace(project: Project, place: Omit<Place, 'id'>, id: string): Project {
  if (project.places.some((p) => p.id === id)) {
    throw new Error(`Place id already exists: ${id}`)
  }
  return { ...project, places: [...project.places, { ...place, id }] }
}

export function updatePlace(
  project: Project,
  id: string,
  patch: Partial<Omit<Place, 'id'>>,
): Project {
  if (!project.places.some((p) => p.id === id)) {
    throw new Error(`No such place: ${id}`)
  }
  return {
    ...project,
    places: project.places.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }
}

export function removePlace(project: Project, id: string): Project {
  return { ...project, places: project.places.filter((p) => p.id !== id) }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/core/graph-places.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/graph.ts tests/core/graph-places.test.ts
git commit -m "feat(core): immutable place mutations"
```

---

## Task 5: Flow mutations and cascade

**Files:**
- Modify: `src/core/graph.ts`
- Test: `tests/core/graph-flows.test.ts`

**Interfaces:**
- Consumes: `addPlace`, `removePlace` from Task 4.
- Produces:
  - `addFlow(project: Project, flow: Omit<Flow, 'id'>, id: string): Project`
  - `removeFlow(project: Project, id: string): Project`
  - `removePlace` now also removes flows touching the removed place.

A dangling flow would fail `validateProject` from Task 3, so removal has to cascade. That is the behaviour worth a test.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/graph-flows.test.ts
import { describe, it, expect } from 'vitest'
import { createEmptyProject } from '../../src/core/project'
import { addPlace, addFlow, removeFlow, removePlace } from '../../src/core/graph'
import type { Flow, Place } from '../../src/core/types'

const NOW = '2026-07-30T09:00:00.000Z'
const place = (name: string): Omit<Place, 'id'> => ({
  name, kind: 'internal', purposeGroup: 'Selling',
  holder: 'you', leavesEEA: false, sources: [], confidence: 'declared',
})
const flow: Omit<Flow, 'id'> = {
  from: 'pl-1', to: 'pl-2', dataDescription: 'Name, email',
  purpose: 'Fulfilling orders', sources: [], confidence: 'declared',
}

function twoPlaces() {
  let p = createEmptyProject('X', NOW)
  p = addPlace(p, place('Website'), 'pl-1')
  p = addPlace(p, place('CRM'), 'pl-2')
  return p
}

describe('flow mutations', () => {
  it('adds a flow between two places', () => {
    const p = addFlow(twoPlaces(), flow, 'fl-1')
    expect(p.flows).toHaveLength(1)
    expect(p.flows[0]?.id).toBe('fl-1')
  })

  it('rejects a flow whose endpoint does not exist', () => {
    const p = twoPlaces()
    expect(() => addFlow(p, { ...flow, to: 'ghost' }, 'fl-1'))
      .toThrow('Flow endpoint does not exist: ghost')
  })

  it('rejects a duplicate flow id', () => {
    const p = addFlow(twoPlaces(), flow, 'fl-1')
    expect(() => addFlow(p, flow, 'fl-1')).toThrow('Flow id already exists: fl-1')
  })

  it('removes a flow', () => {
    let p = addFlow(twoPlaces(), flow, 'fl-1')
    p = removeFlow(p, 'fl-1')
    expect(p.flows).toEqual([])
  })

  it('removing a place also removes every flow touching it', () => {
    let p = addFlow(twoPlaces(), flow, 'fl-1')
    p = removePlace(p, 'pl-2')
    expect(p.places).toHaveLength(1)
    expect(p.flows).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/graph-flows.test.ts`
Expected: FAIL — `addFlow` is not exported.

- [ ] **Step 3: Extend `src/core/graph.ts`**

Change the import line to include `Flow`, add the two new functions, and replace `removePlace` with the cascading version:

```ts
import type { Flow, Place, Project } from './types'

function knownIds(project: Project): Set<string> {
  return new Set<string>([
    ...project.places.map((p) => p.id),
    ...project.subjectGroups.map((s) => s.id),
  ])
}

export function addFlow(project: Project, flow: Omit<Flow, 'id'>, id: string): Project {
  if (project.flows.some((f) => f.id === id)) {
    throw new Error(`Flow id already exists: ${id}`)
  }
  const ids = knownIds(project)
  for (const endpoint of [flow.from, flow.to]) {
    if (!ids.has(endpoint)) {
      throw new Error(`Flow endpoint does not exist: ${endpoint}`)
    }
  }
  return { ...project, flows: [...project.flows, { ...flow, id }] }
}

export function removeFlow(project: Project, id: string): Project {
  return { ...project, flows: project.flows.filter((f) => f.id !== id) }
}

export function removePlace(project: Project, id: string): Project {
  return {
    ...project,
    places: project.places.filter((p) => p.id !== id),
    flows: project.flows.filter((f) => f.from !== id && f.to !== id),
  }
}
```

- [ ] **Step 4: Run both graph suites**

Run: `npx vitest run tests/core/graph-places.test.ts tests/core/graph-flows.test.ts`
Expected: PASS, 11 tests. Task 4's removal test still passes, because removing a place with no flows is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/core/graph.ts tests/core/graph-flows.test.ts
git commit -m "feat(core): flow mutations, cascade flow removal with place"
```

---

## Task 6: Attribute gaps

**Files:**
- Create: `src/core/gaps/attribute.ts`, `tests/fixtures/projects.ts`
- Test: `tests/core/gaps-attribute.test.ts`

**Interfaces:**
- Consumes: `Project`, `Gap` from Task 2.
- Produces: `attributeGaps(project: Project): Gap[]`, plus fixture helpers `emptyProject()`, `place()`, `projectWithPlaces()` in `tests/fixtures/projects.ts`.

Gap ids must be **stable** — the same project always produces the same gap id — so the UI can keep a gap selected across a recompute. Format: `attr:<placeId>:<field>`.

- [ ] **Step 1: Write the fixture helper**

```ts
// tests/fixtures/projects.ts
import { createEmptyProject } from '../../src/core/project'
import { addPlace } from '../../src/core/graph'
import type { Place, Project } from '../../src/core/types'

export const NOW = '2026-07-30T09:00:00.000Z'

export function emptyProject(): Project {
  return createEmptyProject('Fixture', NOW)
}

export function place(over: Partial<Place> = {}): Omit<Place, 'id'> {
  return {
    name: 'A place',
    kind: 'processor',
    purposeGroup: 'Marketing',
    holder: 'supplier',
    leavesEEA: false,
    retention: '2 years',
    sources: [{ documentId: 'd1', documentName: 'dpa.pdf' }],
    confidence: 'declared',
    ...over,
  }
}

export function projectWithPlaces(...drafts: Array<Omit<Place, 'id'>>): Project {
  return drafts.reduce((p, d, i) => addPlace(p, d, `pl-${i + 1}`), emptyProject())
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/core/gaps-attribute.test.ts
import { describe, it, expect } from 'vitest'
import { attributeGaps } from '../../src/core/gaps/attribute'
import { place, projectWithPlaces } from '../fixtures/projects'

describe('attributeGaps', () => {
  it('finds nothing when every field is answered', () => {
    expect(attributeGaps(projectWithPlaces(place()))).toEqual([])
  })

  it('reports a missing retention', () => {
    const gaps = attributeGaps(projectWithPlaces(place({ retention: undefined })))
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.kind).toBe('attribute')
    expect(gaps[0]?.subject).toBe('pl-1')
    expect(gaps[0]?.question).toBe('How long does A place keep this data?')
  })

  it('reports an unknown EEA answer', () => {
    const gaps = attributeGaps(projectWithPlaces(place({ leavesEEA: 'unknown' })))
    expect(gaps.map((g) => g.question)).toContain('Does data sent to A place leave the EEA?')
  })

  it('reports a place with no source at all', () => {
    const gaps = attributeGaps(projectWithPlaces(place({ sources: [] })))
    expect(gaps.map((g) => g.question)).toContain('Which document says A place receives data?')
  })

  it('gives every gap a stable id derived from the place and field', () => {
    const p = projectWithPlaces(place({ retention: undefined }))
    expect(attributeGaps(p)[0]?.id).toBe('attr:pl-1:retention')
    expect(attributeGaps(p)).toEqual(attributeGaps(p))
  })

  it('never reports retention for a place the organisation holds itself', () => {
    const gaps = attributeGaps(projectWithPlaces(place({ holder: 'you', retention: undefined })))
    expect(gaps.map((g) => g.id)).not.toContain('attr:pl-1:retention')
  })
})
```

The last test encodes a real rule: retention for your own systems is a policy question the app does not ask, because the spec keeps compliance content out of scope. Only third-party retention is mapped.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/core/gaps-attribute.test.ts`
Expected: FAIL — cannot resolve `../../src/core/gaps/attribute`.

- [ ] **Step 4: Write `src/core/gaps/attribute.ts`**

```ts
import type { Gap, Project } from '../types'

export function attributeGaps(project: Project): Gap[] {
  const gaps: Gap[] = []

  for (const p of project.places) {
    if (p.sources.length === 0) {
      gaps.push({
        id: `attr:${p.id}:sources`,
        kind: 'attribute',
        subject: p.id,
        question: `Which document says ${p.name} receives data?`,
        why: 'Nothing on file supports this entry, so it cannot be shown to anyone as evidence.',
        severity: 2,
      })
    }

    if (p.leavesEEA === 'unknown') {
      gaps.push({
        id: `attr:${p.id}:leavesEEA`,
        kind: 'attribute',
        subject: p.id,
        question: `Does data sent to ${p.name} leave the EEA?`,
        why: 'Where the data comes to rest is one of the questions this map exists to answer.',
        severity: 1,
      })
    }

    if (p.holder === 'supplier' && !p.retention) {
      gaps.push({
        id: `attr:${p.id}:retention`,
        kind: 'attribute',
        subject: p.id,
        question: `How long does ${p.name} keep this data?`,
        why: 'A supplier holds this data and no document says for how long.',
        severity: 2,
      })
    }
  }

  return gaps
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/core/gaps-attribute.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/gaps/attribute.ts tests/core/gaps-attribute.test.ts tests/fixtures/projects.ts
git commit -m "feat(core): attribute gap detection with stable ids"
```

---

## Task 7: Expectations and existence gaps

**Files:**
- Create: `src/core/expectations.ts`, `src/core/gaps/existence.ts`
- Test: `tests/core/gaps-existence.test.ts`

**Interfaces:**
- Consumes: `Project`, `Gap`.
- Produces:
  - `interface Expectation { id: string; label: string; purposeGroup: string; appliesWhen(p: Project): boolean; satisfiedBy(p: Project): boolean }`
  - `EXPECTATIONS: readonly Expectation[]` — the twelve from the spec
  - `existenceGaps(project: Project): Gap[]`

A false gap costs more than a missed one, because the consultant defends the map in front of a client. Every expectation therefore has a **trigger** — it is asserted only when the project gives a reason to expect it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/gaps-existence.test.ts
import { describe, it, expect } from 'vitest'
import { existenceGaps } from '../../src/core/gaps/existence'
import { EXPECTATIONS } from '../../src/core/expectations'
import { emptyProject, place, projectWithPlaces } from '../fixtures/projects'

function withEmployees() {
  const p = projectWithPlaces(place({ name: 'HR files', purposeGroup: 'Employing people' }))
  return { ...p, subjectGroups: [{ id: 'sg-1', name: 'Employees', estimatedCount: 40 }] }
}

describe('expectations', () => {
  it('ships exactly twelve', () => {
    expect(EXPECTATIONS).toHaveLength(12)
  })

  it('gives every expectation a unique id', () => {
    const ids = EXPECTATIONS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('existenceGaps', () => {
  it('asserts nothing about an empty project', () => {
    expect(existenceGaps(emptyProject())).toEqual([])
  })

  it('expects payroll once the project records employees', () => {
    const gaps = existenceGaps(withEmployees())
    expect(gaps.map((g) => g.id)).toContain('exist:payroll')
    expect(gaps.find((g) => g.id === 'exist:payroll')?.question).toBe('Who processes payroll?')
  })

  it('stops expecting payroll once a payroll place exists', () => {
    const base = withEmployees()
    const p = {
      ...base,
      places: [
        ...base.places,
        { ...place({ name: 'Payroll bureau', purposeGroup: 'Employing people' }), id: 'pl-9' },
      ],
    }
    expect(existenceGaps(p).map((g) => g.id)).not.toContain('exist:payroll')
  })

  it('does not expect payroll when the project records no employees', () => {
    const p = projectWithPlaces(place({ name: 'Newsletter' }))
    expect(existenceGaps(p).map((g) => g.id)).not.toContain('exist:payroll')
  })

  it('phrases the reason neutrally', () => {
    const g = existenceGaps(withEmployees()).find((x) => x.id === 'exist:payroll')
    expect(g?.why).toBe(
      'The project records employees, so something processes their pay. No entry names it yet.',
    )
    expect(g?.why).not.toMatch(/violation|breach|non-compliant|risk/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/gaps-existence.test.ts`
Expected: FAIL — cannot resolve `../../src/core/expectations`.

- [ ] **Step 3: Write `src/core/expectations.ts`**

```ts
import type { Project } from './types'

export interface Expectation {
  id: string
  label: string
  purposeGroup: string
  /** Only assert this expectation when the project gives a reason to. */
  appliesWhen(project: Project): boolean
  satisfiedBy(project: Project): boolean
}

const hasSubject = (p: Project, needle: string): boolean =>
  p.subjectGroups.some((s) => s.name.toLowerCase().includes(needle))

const hasPlaceMatching = (p: Project, words: string[]): boolean =>
  p.places.some((pl) => words.some((w) => pl.name.toLowerCase().includes(w)))

const always = (): boolean => true

function fn(
  id: string,
  label: string,
  purposeGroup: string,
  words: string[],
  appliesWhen: (p: Project) => boolean = always,
): Expectation {
  return {
    id,
    label,
    purposeGroup,
    appliesWhen,
    satisfiedBy: (p) => hasPlaceMatching(p, words),
  }
}

const hasStaff = (p: Project): boolean => hasSubject(p, 'employee') || hasSubject(p, 'staff')
const hasSite = (p: Project): boolean => hasPlaceMatching(p, ['website', 'site', 'shop'])
const hasCustomers = (p: Project): boolean => hasSubject(p, 'customer')

export const EXPECTATIONS: readonly Expectation[] = [
  fn('payroll', 'payroll', 'Employing people', ['payroll', 'salar', 'wage'], hasStaff),
  fn('email', 'email and productivity', 'Running the systems', ['mail', 'workspace', '365', 'outlook']),
  fn('hosting', 'website hosting', 'Running the systems', ['host', 'server', 'cloud'], hasSite),
  fn('analytics', 'website analytics', 'Marketing', ['analytic', 'statistic', 'metrics'], hasSite),
  fn('accounting', 'accounting', 'Getting paid', ['account', 'bookkeep', 'ledger']),
  fn('backup', 'backup', 'Running the systems', ['backup', 'archive', 'snapshot']),
  fn('support', 'customer support', 'Support', ['support', 'helpdesk', 'ticket'], hasCustomers),
  fn('crm', 'customer records', 'Selling', ['crm', 'customer record', 'contact'], hasCustomers),
  fn('payments', 'payment processing', 'Getting paid', ['payment', 'card', 'checkout', 'billing'], hasCustomers),
  fn('delivery', 'order delivery', 'Delivering orders', ['courier', 'shipping', 'delivery', 'post']),
  fn('storage', 'document storage', 'Running the systems', ['drive', 'storage', 'sharepoint', 'dropbox']),
  fn('devices', 'staff device management', 'Running the systems', ['device', 'mdm', 'laptop', 'endpoint'], hasStaff),
]
```

- [ ] **Step 4: Write `src/core/gaps/existence.ts`**

```ts
import { EXPECTATIONS } from '../expectations'
import type { Gap, Project } from '../types'

const WHY: Record<string, string> = {
  payroll: 'The project records employees, so something processes their pay. No entry names it yet.',
}

function questionFor(id: string, label: string): string {
  return id === 'payroll' ? 'Who processes payroll?' : `Who provides ${label}?`
}

export function existenceGaps(project: Project): Gap[] {
  const gaps: Gap[] = []

  for (const e of EXPECTATIONS) {
    if (!e.appliesWhen(project)) continue
    if (e.satisfiedBy(project)) continue
    gaps.push({
      id: `exist:${e.id}`,
      kind: 'existence',
      subject: null,
      question: questionFor(e.id, e.label),
      why: WHY[e.id] ?? `Most organisations have ${e.label}. No entry names one yet.`,
      severity: 2,
    })
  }

  return gaps
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/core/gaps-existence.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/core/expectations.ts src/core/gaps/existence.ts tests/core/gaps-existence.test.ts
git commit -m "feat(core): twelve triggered expectations and existence gaps"
```

---

## Task 8: Merge rules and contradiction gaps

**Files:**
- Create: `src/core/merge.ts`, `src/core/gaps/contradiction.ts`
- Test: `tests/core/merge.test.ts`, `tests/core/gaps-contradiction.test.ts`

**Interfaces:**
- Consumes: `Project`, `Observation`, `Place`, `Gap`.
- Produces:
  - `mergeObservations(project: Project, observations: Observation[], idPrefix: string): Project`
  - `contradictionGaps(project: Project): Gap[]`

This is the highest-value logic in the product. Two evidence streams disagreeing is the finding that changes a client's mind, and it exists only because the app reads documents *and* watches traffic.

- [ ] **Step 1: Write the failing merge test**

```ts
// tests/core/merge.test.ts
import { describe, it, expect } from 'vitest'
import { mergeObservations } from '../../src/core/merge'
import { place, projectWithPlaces } from '../fixtures/projects'
import type { Observation } from '../../src/core/types'

const obs = (domain: string, over: Partial<Observation> = {}): Observation => ({
  domain, requestCount: 3, beforeConsent: false, ...over,
})

describe('mergeObservations', () => {
  it('raises confidence on a place that already accounts for the domain', () => {
    const p = projectWithPlaces(place({ name: 'Newsletter', jurisdiction: 'mailer.example' }))
    const merged = mergeObservations(p, [obs('mailer.example')], 'obs')
    expect(merged.places).toHaveLength(1)
    expect(merged.places[0]?.confidence).toBe('observed')
  })

  it('creates an unknown place for a domain nothing accounts for', () => {
    const p = projectWithPlaces(place({ name: 'Newsletter', jurisdiction: 'mailer.example' }))
    const merged = mergeObservations(p, [obs('tracker.example')], 'obs')
    const created = merged.places.find((x) => x.name === 'tracker.example')
    expect(created?.kind).toBe('unknown')
    expect(created?.holder).toBe('unknown')
    expect(created?.leavesEEA).toBe('unknown')
    expect(created?.confidence).toBe('observed')
    expect(created?.id).toBe('obs-1')
  })

  it('does not create a duplicate when merged twice', () => {
    const p = projectWithPlaces(place())
    const once = mergeObservations(p, [obs('tracker.example')], 'obs')
    const twice = mergeObservations(once, [obs('tracker.example')], 'obs')
    expect(twice.places.filter((x) => x.name === 'tracker.example')).toHaveLength(1)
  })

  it('never overwrites what a human or a document declared', () => {
    const p = projectWithPlaces(
      place({
        name: 'Newsletter', jurisdiction: 'mailer.example',
        confidence: 'declared', retention: '2 years',
      }),
    )
    const merged = mergeObservations(p, [obs('mailer.example')], 'obs')
    expect(merged.places[0]?.retention).toBe('2 years')
    expect(merged.places[0]?.name).toBe('Newsletter')
  })

  it('records the observations on the project', () => {
    const merged = mergeObservations(projectWithPlaces(place()), [obs('a.example')], 'obs')
    expect(merged.observations).toHaveLength(1)
    expect(merged.observations[0]?.domain).toBe('a.example')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/merge.test.ts`
Expected: FAIL — cannot resolve `../../src/core/merge`.

- [ ] **Step 3: Write `src/core/merge.ts`**

```ts
import type { Observation, Place, Project } from './types'

function accountedFor(places: readonly Place[], domain: string): Place | undefined {
  const needle = domain.toLowerCase()
  return places.find((p) => `${p.name} ${p.jurisdiction ?? ''}`.toLowerCase().includes(needle))
}

export function mergeObservations(
  project: Project,
  observations: Observation[],
  idPrefix: string,
): Project {
  let places = [...project.places]
  let created = 0

  for (const o of observations) {
    const match = accountedFor(places, o.domain)
    if (match) {
      // Seeing it confirms it exists. Every other field a human or document set is left alone.
      places = places.map((p) => (p.id === match.id ? { ...p, confidence: 'observed' } : p))
      continue
    }
    created += 1
    places = [
      ...places,
      {
        id: `${idPrefix}-${created}`,
        name: o.domain,
        kind: 'unknown',
        purposeGroup: 'Running the systems',
        holder: 'unknown',
        leavesEEA: 'unknown',
        sources: [],
        confidence: 'observed',
      },
    ]
  }

  const seen = new Set(project.observations.map((o) => o.domain))
  const fresh = observations.filter((o) => !seen.has(o.domain))

  return { ...project, places, observations: [...project.observations, ...fresh] }
}
```

- [ ] **Step 4: Run the merge test**

Run: `npx vitest run tests/core/merge.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing contradiction test**

```ts
// tests/core/gaps-contradiction.test.ts
import { describe, it, expect } from 'vitest'
import { contradictionGaps } from '../../src/core/gaps/contradiction'
import { mergeObservations } from '../../src/core/merge'
import { place, projectWithPlaces } from '../fixtures/projects'

describe('contradictionGaps', () => {
  it('finds nothing when no scan has run', () => {
    expect(contradictionGaps(projectWithPlaces(place()))).toEqual([])
  })

  it('reports each recipient no document accounts for', () => {
    const merged = mergeObservations(
      projectWithPlaces(place({ name: 'Newsletter', jurisdiction: 'mailer.example' })),
      [{ domain: 'tracker.example', requestCount: 9, beforeConsent: false }],
      'obs',
    )
    const gaps = contradictionGaps(merged)
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.kind).toBe('contradiction')
    expect(gaps[0]?.question).toBe('What is tracker.example, and why does it receive data?')
  })

  it('raises severity when the recipient was contacted before consent', () => {
    const merged = mergeObservations(
      projectWithPlaces(place()),
      [{ domain: 'tracker.example', requestCount: 2, beforeConsent: true }],
      'obs',
    )
    expect(contradictionGaps(merged)[0]?.severity).toBe(1)
  })

  it('uses a stable id per domain', () => {
    const merged = mergeObservations(
      projectWithPlaces(place()),
      [{ domain: 'tracker.example', requestCount: 2, beforeConsent: false }],
      'obs',
    )
    expect(contradictionGaps(merged)[0]?.id).toBe('contra:tracker.example')
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/core/gaps-contradiction.test.ts`
Expected: FAIL — cannot resolve `../../src/core/gaps/contradiction`.

- [ ] **Step 7: Write `src/core/gaps/contradiction.ts`**

```ts
import type { Gap, Project } from '../types'

export function contradictionGaps(project: Project): Gap[] {
  const gaps: Gap[] = []

  for (const o of project.observations) {
    const p = project.places.find((x) => x.name === o.domain && x.kind === 'unknown')
    if (!p) continue
    gaps.push({
      id: `contra:${o.domain}`,
      kind: 'contradiction',
      subject: p.id,
      question: `What is ${o.domain}, and why does it receive data?`,
      why: o.beforeConsent
        ? `Contacted ${o.requestCount} times before anyone accepted cookies, and no document names it.`
        : `Contacted ${o.requestCount} times during the scan, and no document names it.`,
      severity: o.beforeConsent ? 1 : 2,
    })
  }

  return gaps
}
```

- [ ] **Step 8: Run the contradiction test**

Run: `npx vitest run tests/core/gaps-contradiction.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Commit**

```bash
git add src/core/merge.ts src/core/gaps/contradiction.ts tests/core/merge.test.ts tests/core/gaps-contradiction.test.ts
git commit -m "feat(core): observation merge rules and contradiction gaps"
```

---

## Task 9: The gap orchestrator

**Files:**
- Create: `src/core/gaps/index.ts`
- Test: `tests/core/gaps-compute.test.ts`

**Interfaces:**
- Consumes: `attributeGaps`, `existenceGaps`, `contradictionGaps`.
- Produces: `computeGaps(project: Project): Gap[]` — ranked by severity ascending, then by id, so the order is deterministic. Re-exports the three detectors.

The behaviour that matters most: a gap **closes** when evidence arrives and **reopens**, with the same id, if it is removed. That is what makes enrichment feel like progress.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/gaps-compute.test.ts
import { describe, it, expect } from 'vitest'
import { computeGaps } from '../../src/core/gaps'
import { updatePlace } from '../../src/core/graph'
import { place, projectWithPlaces } from '../fixtures/projects'

describe('computeGaps', () => {
  it('returns gaps of every applicable kind together', () => {
    const p = {
      ...projectWithPlaces(place({ retention: undefined })),
      subjectGroups: [{ id: 'sg-1', name: 'Employees' }],
    }
    const kinds = new Set(computeGaps(p).map((g) => g.kind))
    expect(kinds.has('attribute')).toBe(true)
    expect(kinds.has('existence')).toBe(true)
  })

  it('ranks severity 1 before severity 2', () => {
    const p = projectWithPlaces(place({ leavesEEA: 'unknown', retention: undefined }))
    expect(computeGaps(p)[0]?.severity).toBe(1)
  })

  it('is deterministic across calls', () => {
    const p = projectWithPlaces(place({ retention: undefined }))
    expect(computeGaps(p)).toEqual(computeGaps(p))
  })

  it('closes a gap when the answer arrives', () => {
    let p = projectWithPlaces(place({ retention: undefined }))
    expect(computeGaps(p).map((g) => g.id)).toContain('attr:pl-1:retention')
    p = updatePlace(p, 'pl-1', { retention: '18 months' })
    expect(computeGaps(p).map((g) => g.id)).not.toContain('attr:pl-1:retention')
  })

  it('reopens the same gap, with the same id, if the answer is removed', () => {
    let p = projectWithPlaces(place({ retention: '18 months' }))
    p = updatePlace(p, 'pl-1', { retention: undefined })
    expect(computeGaps(p).map((g) => g.id)).toContain('attr:pl-1:retention')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/gaps-compute.test.ts`
Expected: FAIL — cannot resolve `../../src/core/gaps`.

- [ ] **Step 3: Write `src/core/gaps/index.ts`**

```ts
import type { Gap, Project } from '../types'
import { attributeGaps } from './attribute'
import { contradictionGaps } from './contradiction'
import { existenceGaps } from './existence'

export { attributeGaps, contradictionGaps, existenceGaps }

export function computeGaps(project: Project): Gap[] {
  return [
    ...contradictionGaps(project),
    ...attributeGaps(project),
    ...existenceGaps(project),
  ].sort((a, b) => a.severity - b.severity || a.id.localeCompare(b.id))
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add src/core/gaps/index.ts tests/core/gaps-compute.test.ts
git commit -m "feat(core): computeGaps orchestrator, ranked and deterministic"
```

---

## Task 10: Deterministic radial layout

**Files:**
- Create: `src/core/layout.ts`
- Test: `tests/core/layout.test.ts`

**Interfaces:**
- Consumes: `Project`.
- Produces:
  - `interface LayoutNode { id: string; kind: 'subject' | 'group'; label: string; x: number; y: number; count?: number; leavesEEA?: number; unexplained?: number }`
  - `interface LayoutEdge { from: string; to: string }`
  - `interface LayoutResult { nodes: LayoutNode[]; edges: LayoutEdge[] }`
  - `computeLayout(project: Project, size: { width: number; height: number }): LayoutResult`

Positions must be stable across sessions — a map that rearranges itself is not trustworthy. Groups are sorted alphabetically and placed on an ellipse, so the same project always draws the same picture. No force simulation.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/layout.test.ts
import { describe, it, expect } from 'vitest'
import { computeLayout } from '../../src/core/layout'
import { place, projectWithPlaces } from '../fixtures/projects'

const SIZE = { width: 800, height: 500 }

function mixed() {
  return projectWithPlaces(
    place({ name: 'Newsletter', purposeGroup: 'Marketing', leavesEEA: true }),
    place({ name: 'Ads', purposeGroup: 'Marketing', kind: 'unknown', leavesEEA: 'unknown' }),
    place({ name: 'Helpdesk', purposeGroup: 'Support' }),
  )
}

describe('computeLayout', () => {
  it('puts one node at the centre for the people', () => {
    const centre = computeLayout(mixed(), SIZE).nodes.find((n) => n.kind === 'subject')
    expect(centre?.x).toBe(400)
    expect(centre?.y).toBe(250)
  })

  it('emits one node per occupied purpose group, alphabetically', () => {
    const groups = computeLayout(mixed(), SIZE).nodes.filter((n) => n.kind === 'group')
    expect(groups.map((g) => g.label)).toEqual(['Marketing', 'Support'])
  })

  it('counts places, EEA departures and unexplained per group', () => {
    const mk = computeLayout(mixed(), SIZE).nodes.find((n) => n.label === 'Marketing')
    expect(mk?.count).toBe(2)
    expect(mk?.leavesEEA).toBe(1)
    expect(mk?.unexplained).toBe(1)
  })

  it('connects every group to the centre', () => {
    const l = computeLayout(mixed(), SIZE)
    expect(l.edges).toHaveLength(2)
    expect(l.edges.every((e) => e.from === 'centre')).toBe(true)
  })

  it('produces identical coordinates on repeat calls', () => {
    expect(computeLayout(mixed(), SIZE)).toEqual(computeLayout(mixed(), SIZE))
  })

  it('leaves out purpose groups that hold nothing', () => {
    const labels = computeLayout(mixed(), SIZE).nodes.map((n) => n.label)
    expect(labels).not.toContain('Delivering orders')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/layout.test.ts`
Expected: FAIL — cannot resolve `../../src/core/layout`.

- [ ] **Step 3: Write `src/core/layout.ts`**

```ts
import type { Project } from './types'

export interface LayoutNode {
  id: string
  kind: 'subject' | 'group'
  label: string
  x: number
  y: number
  count?: number
  leavesEEA?: number
  unexplained?: number
}

export interface LayoutEdge {
  from: string
  to: string
}

export interface LayoutResult {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
}

/** Two decimals keeps the SVG readable and the equality tests exact. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}

export function computeLayout(
  project: Project,
  size: { width: number; height: number },
): LayoutResult {
  const cx = size.width / 2
  const cy = size.height / 2
  const rx = size.width * 0.32
  const ry = size.height * 0.3

  const occupied = [...new Set(project.places.map((p) => p.purposeGroup))].sort()

  const nodes: LayoutNode[] = [
    {
      id: 'centre',
      kind: 'subject',
      label: 'People',
      x: cx,
      y: cy,
      count: project.subjectGroups.length,
    },
  ]
  const edges: LayoutEdge[] = []

  occupied.forEach((group, i) => {
    const angle = (i / occupied.length) * Math.PI * 2 - Math.PI / 2
    const inGroup = project.places.filter((p) => p.purposeGroup === group)
    nodes.push({
      id: `group:${group}`,
      kind: 'group',
      label: group,
      x: round(cx + Math.cos(angle) * rx),
      y: round(cy + Math.sin(angle) * ry),
      count: inGroup.length,
      leavesEEA: inGroup.filter((p) => p.leavesEEA === true).length,
      unexplained: inGroup.filter((p) => p.kind === 'unknown').length,
    })
    edges.push({ from: 'centre', to: `group:${group}` })
  })

  return { nodes, edges }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/core/layout.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/layout.ts tests/core/layout.test.ts
git commit -m "feat(core): deterministic radial layout"
```

---

## Task 11: Egress guard — SECURITY GATE

**Files:**
- Create: `src/main/egressGuard.ts`
- Test: `tests/main/egressGuard.test.ts`, `tests/main/noRemoteAssets.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface EgressDecision { allow: boolean; reason: string }`
  - `interface GuardableSession { webRequest: { onBeforeRequest(filter: { urls: string[] }, listener: (details: { url: string }, callback: (r: { cancel: boolean }) => void) => void): void } }`
  - `decideEgress(url: string, scanOrigins: readonly string[]): EgressDecision`
  - `installEgressGuard(session: GuardableSession, getScanOrigins: () => readonly string[]): void`

This is the executable form of the product's central promise. It is installed before any window is created, so nothing can slip out during startup.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/egressGuard.test.ts
import { describe, it, expect, vi } from 'vitest'
import { decideEgress, installEgressGuard } from '../../src/main/egressGuard'
import type { GuardableSession } from '../../src/main/egressGuard'

type Listener = (d: { url: string }, cb: (r: { cancel: boolean }) => void) => void

function fakeSession(): { session: GuardableSession; fire: (url: string) => { cancel: boolean } } {
  let listener: Listener | null = null
  const session: GuardableSession = {
    webRequest: { onBeforeRequest: (_f, l) => { listener = l as Listener } },
  }
  return {
    session,
    fire: (url) => {
      const cb = vi.fn()
      listener?.({ url }, cb)
      return cb.mock.calls[0]?.[0] as { cancel: boolean }
    },
  }
}

describe('decideEgress', () => {
  it('allows local app resources', () => {
    expect(decideEgress('file:///app/index.html', []).allow).toBe(true)
    expect(decideEgress('devtools://devtools/bundled/x.js', []).allow).toBe(true)
  })

  it('blocks a font CDN even though it looks harmless', () => {
    const d = decideEgress('https://fonts.googleapis.com/css2?family=Inter', [])
    expect(d.allow).toBe(false)
    expect(d.reason).toBe('Not a scan target: fonts.googleapis.com')
  })

  it('blocks any remote host when no scan is running', () => {
    expect(decideEgress('https://example.com/x.png', []).allow).toBe(false)
  })

  it('allows the scan target and its subdomains while a scan runs', () => {
    const origins = ['rossi-editore.it']
    expect(decideEgress('https://rossi-editore.it/', origins).allow).toBe(true)
    expect(decideEgress('https://www.rossi-editore.it/a.css', origins).allow).toBe(true)
  })

  it('still blocks third parties during a scan', () => {
    expect(decideEgress('https://tracker.example/px.gif', ['rossi-editore.it']).allow).toBe(false)
  })

  it('does not treat a lookalike host as the scan target', () => {
    expect(decideEgress('https://rossi-editore.it.evil.example/', ['rossi-editore.it']).allow).toBe(false)
  })

  it('blocks a malformed url rather than letting it through', () => {
    expect(decideEgress('not a url', ['rossi-editore.it']).allow).toBe(false)
  })
})

describe('installEgressGuard', () => {
  it('cancels a request the decision rejects', () => {
    const { session, fire } = fakeSession()
    installEgressGuard(session, () => [])
    expect(fire('https://fonts.googleapis.com/css2')).toEqual({ cancel: true })
  })

  it('lets a file url through', () => {
    const { session, fire } = fakeSession()
    installEgressGuard(session, () => [])
    expect(fire('file:///app/index.html')).toEqual({ cancel: false })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/egressGuard.test.ts`
Expected: FAIL — cannot resolve `../../src/main/egressGuard`.

- [ ] **Step 3: Write `src/main/egressGuard.ts`**

```ts
export interface EgressDecision {
  allow: boolean
  reason: string
}

export interface GuardableSession {
  webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      listener: (
        details: { url: string },
        callback: (response: { cancel: boolean }) => void,
      ) => void,
    ): void
  }
}

const LOCAL_SCHEMES = ['file:', 'devtools:', 'data:', 'blob:', 'chrome-extension:']

export function decideEgress(url: string, scanOrigins: readonly string[]): EgressDecision {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { allow: false, reason: 'Malformed URL' }
  }

  if (LOCAL_SCHEMES.includes(parsed.protocol)) {
    return { allow: true, reason: 'Local resource' }
  }

  const host = parsed.hostname.toLowerCase()
  for (const origin of scanOrigins) {
    const o = origin.toLowerCase()
    if (host === o || host.endsWith(`.${o}`)) {
      return { allow: true, reason: `Scan target: ${o}` }
    }
  }

  return { allow: false, reason: `Not a scan target: ${host}` }
}

export function installEgressGuard(
  session: GuardableSession,
  getScanOrigins: () => readonly string[],
): void {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const decision = decideEgress(details.url, getScanOrigins())
    callback({ cancel: !decision.allow })
  })
}
```

Note for the auditor: third-party requests during a scan are **cancelled, not allowed**. The scanner learns what it needs from the attempt itself — the request is seen at `onBeforeRequest` and then stopped. Nothing is ever sent to a third party.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/main/egressGuard.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the source-level check**

```ts
// tests/main/noRemoteAssets.test.ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

describe('no remote assets in source', () => {
  it('has no http(s) URL in code anywhere under src/', () => {
    const out = execSync('grep -rEn "https?://" src/ || true').toString().trim()
    const offenders = out
      .split('\n')
      .filter(Boolean)
      // Comments explaining the rule are allowed; code is not.
      .filter((line) => !/^\S+:\d+:\s*(\/\/|\*|\/\*)/.test(line))
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 6: Run it**

Run: `npx vitest run tests/main/noRemoteAssets.test.ts`
Expected: PASS. A failure means an asset or dependency reference is reaching a remote host — remove it and bundle the asset instead.

- [ ] **Step 7: SECURITY GATE**

Dispatch **security-auditor** on this diff before committing. It must return PASS. If it returns BLOCK, fix and re-run.

- [ ] **Step 8: Commit**

```bash
git add src/main/egressGuard.ts tests/main/egressGuard.test.ts tests/main/noRemoteAssets.test.ts
git commit -m "feat(main): egress guard blocking all non-scan network traffic"
```

---

## Task 12: Project file persistence — SECURITY GATE

**Files:**
- Create: `src/main/projectFile.ts`
- Test: `tests/main/projectFile.test.ts`

**Interfaces:**
- Consumes: `validateProject` from Task 3, `Project` from Task 2.
- Produces:
  - `readProjectFile(path: string): Promise<Project>` — rejects with the validation errors joined by newlines
  - `writeProjectFile(path: string, project: Project): Promise<void>` — atomic

Atomic write matters: a crash mid-save must never leave a user with a half-written map. Write to a temp file in the same directory, then rename — rename is atomic on the same filesystem.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/projectFile.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProjectFile, writeProjectFile } from '../../src/main/projectFile'
import { createEmptyProject } from '../../src/core/project'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'traccia-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const NOW = '2026-07-30T09:00:00.000Z'

describe('project file', () => {
  it('round-trips a project', async () => {
    const p = createEmptyProject('Rossi Editore', NOW)
    const file = join(dir, 'a.json')
    await writeProjectFile(file, p)
    expect(await readProjectFile(file)).toEqual(p)
  })

  it('writes readable, indented JSON', async () => {
    const file = join(dir, 'b.json')
    await writeProjectFile(file, createEmptyProject('X', NOW))
    expect((await readFile(file, 'utf8')).startsWith('{\n  "schemaVersion": 1')).toBe(true)
  })

  it('leaves no temp file behind on success', async () => {
    const file = join(dir, 'c.json')
    await writeProjectFile(file, createEmptyProject('X', NOW))
    expect((await readdir(dir)).filter((f) => f.includes('.tmp'))).toEqual([])
  })

  it('rejects a corrupt file with the validation errors', async () => {
    const file = join(dir, 'bad.json')
    await writeFile(file, '{"schemaVersion": 99}', 'utf8')
    await expect(readProjectFile(file)).rejects.toThrow(/Unsupported schemaVersion: 99/)
  })

  it('rejects a file that is not JSON at all', async () => {
    const file = join(dir, 'junk.json')
    await writeFile(file, 'not json', 'utf8')
    await expect(readProjectFile(file)).rejects.toThrow(/could not be read/i)
  })

  // Windows and macOS differ here. rename() must overwrite, not fail, when the target exists.
  it('overwrites an existing project file', async () => {
    const file = join(dir, 'twice.json')
    await writeProjectFile(file, createEmptyProject('First', NOW))
    await writeProjectFile(file, createEmptyProject('Second', NOW))
    expect((await readProjectFile(file)).name).toBe('Second')
  })

  it('overwrites repeatedly without leaving temp files', async () => {
    const file = join(dir, 'many.json')
    for (const n of ['a', 'b', 'c', 'd']) {
      await writeProjectFile(file, createEmptyProject(n, NOW))
    }
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect((await readProjectFile(file)).name).toBe('d')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/projectFile.test.ts`
Expected: FAIL — cannot resolve `../../src/main/projectFile`.

- [ ] **Step 3: Write `src/main/projectFile.ts`**

```ts
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { validateProject } from '../core/project'
import type { Project } from '../core/types'

export async function readProjectFile(path: string): Promise<Project> {
  const raw = await readFile(path, 'utf8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('This file could not be read as a project.')
  }

  const result = validateProject(parsed)
  if (!result.ok) throw new Error(result.errors.join('\n'))
  return result.project
}

const RETRY_DELAYS_MS = [0, 50, 150, 400]

function isTransientWindowsLock(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function writeProjectFile(path: string, project: Project): Promise<void> {
  // Date.now() is fine here: this is src/main, not src/core, and the name only needs to be unique.
  const tmp = join(dirname(path), `.${Date.now()}.tmp`)
  try {
    await writeFile(tmp, JSON.stringify(project, null, 2), 'utf8')

    // rename overwrites on both platforms, but on Windows it fails transiently when antivirus or
    // another program holds the target open. Retry rather than surfacing an error nobody can act on.
    let lastError: unknown
    for (const delay of RETRY_DELAYS_MS) {
      if (delay > 0) await wait(delay)
      try {
        await rename(tmp, path)
        return
      } catch (err) {
        if (!isTransientWindowsLock(err)) throw err
        lastError = err
      }
    }
    throw new Error(
      'The project could not be saved because another program is holding the file open. ' +
        'Close it and try again.',
      { cause: lastError },
    )
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/main/projectFile.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: SECURITY GATE**

Dispatch **security-auditor**. It must confirm: the temp file is removed on failure, the rename target is the user's chosen path and nothing else, no project content reaches a log line, and the retry loop cannot spin indefinitely.

- [ ] **Step 6: Commit**

```bash
git add src/main/projectFile.ts tests/main/projectFile.test.ts
git commit -m "feat(main): atomic project file read and write"
```

---

## Task 13: Electron shell, IPC and the map UI — SECURITY GATE

**Files:**
- Create: `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/index.ts`
- Create: `src/renderer/main.tsx`, `src/renderer/App.tsx`
- Create: `src/renderer/components/MapView.tsx`, `src/renderer/components/RegisterPanel.tsx`
- Create: `electron.vite.config.ts`, `index.html`

**Interfaces:**
- Consumes: `computeLayout` (Task 10), `computeGaps` (Task 9), `readProjectFile` and `writeProjectFile` (Task 12), `installEgressGuard` (Task 11), `validateProject` (Task 3).
- Produces: a running app. Preload exposes exactly `window.traccia = { openProject(): Promise<Project | null>, saveProject(p: Project): Promise<boolean> }` and nothing else.

The renderer never touches the filesystem. It asks the main process to run a dialog and gets back a validated `Project` or `null`. That narrow surface is the point.

- [ ] **Step 1: Write `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { Project } from '../core/types'

contextBridge.exposeInMainWorld('traccia', {
  openProject: (): Promise<Project | null> => ipcRenderer.invoke('project:open'),
  saveProject: (project: Project): Promise<boolean> =>
    ipcRenderer.invoke('project:save', project),
})
```

- [ ] **Step 2: Write `src/main/ipc.ts`**

```ts
import { dialog, ipcMain } from 'electron'
import { readProjectFile, writeProjectFile } from './projectFile'
import { validateProject } from '../core/project'

const FILTERS = [{ name: 'Traccia project', extensions: ['json'] }]

export function registerIpc(): void {
  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: FILTERS })
    if (r.canceled || !r.filePaths[0]) return null
    return readProjectFile(r.filePaths[0])
  })

  ipcMain.handle('project:save', async (_e, project: unknown) => {
    // Never trust the renderer. Validate before anything reaches the disk.
    const checked = validateProject(project)
    if (!checked.ok) throw new Error(checked.errors.join('\n'))

    const r = await dialog.showSaveDialog({ filters: FILTERS })
    if (r.canceled || !r.filePath) return false
    await writeProjectFile(r.filePath, checked.project)
    return true
  })
}
```

- [ ] **Step 3: Write `src/main/index.ts`**

```ts
import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { installEgressGuard } from './egressGuard'
import { registerIpc } from './ipc'

/** Populated only while a scan is running. Empty in Phase 1. */
const scanOrigins: string[] = []

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  // Installed before any window exists, so nothing escapes during startup.
  installEgressGuard(session.defaultSession, () => scanOrigins)
  registerIpc()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 4: Write `src/renderer/components/MapView.tsx`**

```tsx
import type { LayoutResult } from '../../core/layout'

interface Props {
  layout: LayoutResult
  selected: string | null
  onSelect: (id: string | null) => void
}

export function MapView({ layout, selected, onSelect }: Props) {
  return (
    <svg viewBox="0 0 800 500" style={{ width: '100%', display: 'block' }}
         onClick={() => onSelect(null)}>
      {layout.edges.map((e) => {
        const a = layout.nodes.find((n) => n.id === e.from)
        const b = layout.nodes.find((n) => n.id === e.to)
        if (!a || !b) return null
        return (
          <line key={`${e.from}->${e.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="#17171A" strokeWidth={1.5} />
        )
      })}

      {layout.nodes.map((n) => {
        const dim = selected !== null && selected !== n.id
        if (n.kind === 'subject') {
          return (
            <g key={n.id} opacity={dim ? 0.25 : 1}>
              <circle cx={n.x} cy={n.y} r={44} fill="#17171A" />
              <text x={n.x} y={n.y + 4} textAnchor="middle" fill="#F7F6F2" fontSize={13}>
                {n.label}
              </text>
            </g>
          )
        }
        return (
          <g key={n.id} opacity={dim ? 0.25 : 1} style={{ cursor: 'pointer' }}
             onClick={(ev) => { ev.stopPropagation(); onSelect(n.id) }}>
            <rect x={n.x - 70} y={n.y - 28} width={140} height={56}
                  fill="#F7F6F2" stroke="#17171A" strokeWidth={1.5} />
            <rect x={n.x - 70} y={n.y - 28} width={140} height={7} fill="#17171A" />
            <text x={n.x - 58} y={n.y + 1} fontSize={10.5} fontWeight={700}>{n.label}</text>
            <text x={n.x - 58} y={n.y + 15} fontSize={9} fill="#9C978E">{n.count} places</text>
            {n.leavesEEA ? (
              <>
                <rect x={n.x + 20} y={n.y + 5} width={22} height={15} fill="#E2411E" />
                <text x={n.x + 31} y={n.y + 16} textAnchor="middle" fontSize={9} fill="#F7F6F2">
                  {n.leavesEEA}
                </text>
              </>
            ) : null}
            {n.unexplained ? (
              <>
                <rect x={n.x + 46} y={n.y + 5} width={22} height={15}
                      fill="none" stroke="#E2411E" strokeWidth={1.5} />
                <text x={n.x + 57} y={n.y + 16} textAnchor="middle" fontSize={9} fill="#E2411E">
                  {n.unexplained}?
                </text>
              </>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}
```

- [ ] **Step 5: Write `src/renderer/components/RegisterPanel.tsx`**

```tsx
import type { Gap } from '../../core/types'

interface Props {
  gaps: Gap[]
  onHover: (subject: string | null) => void
}

export function RegisterPanel({ gaps, onHover }: Props) {
  return (
    <aside style={{ width: 280, borderLeft: '1px solid #D8D4CB', padding: 16 }}>
      <h2 style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
        Not yet identified · {gaps.length}
      </h2>
      {gaps.length === 0 ? (
        <p style={{ fontSize: 12, color: '#9C978E' }}>
          Nothing outstanding. Add a place or run a scan to find more.
        </p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {gaps.map((g) => (
            <li key={g.id}
                onMouseEnter={() => onHover(g.subject)}
                onMouseLeave={() => onHover(null)}
                style={{ padding: '10px 0', borderBottom: '1px solid #D8D4CB' }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>{g.question}</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6B6459' }}>{g.why}</p>
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
```

- [ ] **Step 6: Write `src/renderer/App.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { createEmptyProject } from '../core/project'
import { computeGaps } from '../core/gaps'
import { computeLayout } from '../core/layout'
import type { Project } from '../core/types'
import { MapView } from './components/MapView'
import { RegisterPanel } from './components/RegisterPanel'

declare global {
  interface Window {
    traccia: {
      openProject(): Promise<Project | null>
      saveProject(p: Project): Promise<boolean>
    }
  }
}

export function App() {
  const [project, setProject] = useState<Project>(() =>
    createEmptyProject('Untitled', new Date().toISOString()),
  )
  const [selected, setSelected] = useState<string | null>(null)

  const layout = useMemo(() => computeLayout(project, { width: 800, height: 500 }), [project])
  const gaps = useMemo(() => computeGaps(project), [project])

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#F7F6F2' }}>
      <main style={{ flex: 1, padding: 20 }}>
        <header style={{ display: 'flex', gap: 12, alignItems: 'baseline', marginBottom: 16 }}>
          <strong>{project.name}</strong>
          <button onClick={async () => {
            const p = await window.traccia.openProject()
            if (p) setProject(p)
          }}>Open</button>
          <button onClick={() => window.traccia.saveProject(project)}>Save</button>
        </header>
        <MapView layout={layout} selected={selected} onSelect={setSelected} />
      </main>
      <RegisterPanel gaps={gaps} onHover={setSelected} />
    </div>
  )
}
```

- [ ] **Step 7: Write `src/renderer/main.tsx` and `index.html`**

```tsx
// src/renderer/main.tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

const el = document.getElementById('root')
if (el) createRoot(el).render(<App />)
```

```html
<!-- index.html -->
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'" />
    <title>Traccia</title>
  </head>
  <body style="margin:0">
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

`connect-src 'none'` is a second, independent line of defence behind the egress guard. Both must be present.

- [ ] **Step 8: Write `electron.vite.config.ts`**

```ts
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { rollupOptions: { input: 'src/main/index.ts' } } },
  preload: { build: { rollupOptions: { input: 'src/preload/index.ts' } } },
  renderer: { root: '.', plugins: [react()] },
})
```

- [ ] **Step 9: Run it and check by hand**

Run: `npm run dev`
Expected: a window opens showing an empty map with a "People" disc at the centre and a register reading "Nothing outstanding." Open a saved project file and confirm groups appear with counts.

- [ ] **Step 10: Confirm the whole suite still passes**

Run: `npm test && npm run typecheck`
Expected: all suites pass, no type errors.

- [ ] **Step 11: SECURITY GATE**

Dispatch **security-auditor**. It must confirm: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the preload exposes exactly two functions and no filesystem or shell access; `project:save` validates before writing; the CSP is present; the egress guard is installed before `createWindow`.

- [ ] **Step 12: Commit**

```bash
git add src/main src/preload src/renderer index.html electron.vite.config.ts
git commit -m "feat: electron shell, narrow ipc surface, map and register ui"
```

---

## Task 14: Undo, and one place for every string

**Files:**
- Create: `src/renderer/strings.ts`, `src/core/history.ts`
- Modify: `src/renderer/App.tsx`, `src/renderer/components/MapView.tsx`, `src/renderer/components/RegisterPanel.tsx`
- Test: `tests/core/history.test.ts`

**Interfaces:**
- Consumes: `Project` from Task 2.
- Produces:
  - `interface History { past: Project[]; present: Project; future: Project[] }`
  - `initHistory(project: Project): History`
  - `push(history: History, next: Project): History`
  - `undo(history: History): History`
  - `redo(history: History): History`
  - `canUndo(history: History): boolean`, `canRedo(history: History): boolean`
  - `STRINGS` — a flat object of every user-facing string

Undo is almost free here because the core is immutable: a history is three arrays of `Project`
snapshots. Correcting a map by hand without undo is miserable, and retrofitting it after the editing
UI exists is much harder than building it in.

- [ ] **Step 1: Write the failing test**

```ts
// tests/core/history.test.ts
import { describe, it, expect } from 'vitest'
import { initHistory, push, undo, redo, canUndo, canRedo } from '../../src/core/history'
import { updatePlace } from '../../src/core/graph'
import { place, projectWithPlaces } from '../fixtures/projects'

const base = () => projectWithPlaces(place({ name: 'Newsletter' }))

describe('history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = initHistory(base())
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('undo restores the previous project', () => {
    const start = base()
    const h = push(initHistory(start), updatePlace(start, 'pl-1', { retention: '1 year' }))
    expect(h.present.places[0]?.retention).toBe('1 year')
    expect(undo(h).present.places[0]?.retention).toBe('2 years')
  })

  it('redo reapplies what undo removed', () => {
    const start = base()
    const h = push(initHistory(start), updatePlace(start, 'pl-1', { retention: '1 year' }))
    expect(redo(undo(h)).present.places[0]?.retention).toBe('1 year')
  })

  it('a new change discards the redo branch', () => {
    const start = base()
    let h = push(initHistory(start), updatePlace(start, 'pl-1', { retention: '1 year' }))
    h = undo(h)
    h = push(h, updatePlace(h.present, 'pl-1', { retention: '5 years' }))
    expect(canRedo(h)).toBe(false)
    expect(h.present.places[0]?.retention).toBe('5 years')
  })

  it('undo at the beginning is a no-op', () => {
    const h = initHistory(base())
    expect(undo(h)).toEqual(h)
  })

  it('keeps at most 50 past states', () => {
    let h = initHistory(base())
    for (let i = 0; i < 60; i += 1) {
      h = push(h, updatePlace(h.present, 'pl-1', { retention: `${i} years` }))
    }
    expect(h.past).toHaveLength(50)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/core/history.test.ts`
Expected: FAIL — cannot resolve `../../src/core/history`.

- [ ] **Step 3: Write `src/core/history.ts`**

```ts
import type { Project } from './types'

const LIMIT = 50

export interface History {
  past: Project[]
  present: Project
  future: Project[]
}

export function initHistory(project: Project): History {
  return { past: [], present: project, future: [] }
}

export function push(history: History, next: Project): History {
  const past = [...history.past, history.present].slice(-LIMIT)
  return { past, present: next, future: [] }
}

export function canUndo(history: History): boolean {
  return history.past.length > 0
}

export function canRedo(history: History): boolean {
  return history.future.length > 0
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1]
  if (previous === undefined) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redo(history: History): History {
  const next = history.future[0]
  if (next === undefined) return history
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/core/history.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `src/renderer/strings.ts`**

```ts
/**
 * Every user-facing string. Nothing outside this file may contain display text.
 * English only in v1; adding Italian later means adding a second object here, not
 * touching components.
 */
export const STRINGS = {
  open: 'Open',
  save: 'Save',
  undo: 'Undo',
  redo: 'Redo',
  untitled: 'Untitled',
  people: 'People',
  placesInGroup: (n: number): string => `${n} places`,
  registerHeading: (n: number): string => `Not yet identified · ${n}`,
  registerEmpty: 'Nothing outstanding. Add a place or run a scan to find more.',
  saveBlocked:
    'The project could not be saved because another program is holding the file open. Close it and try again.',
} as const
```

- [ ] **Step 6: Replace every literal in the three renderer files**

In `MapView.tsx`, `RegisterPanel.tsx` and `App.tsx`, import `STRINGS` and replace each display
literal. For example, in `RegisterPanel.tsx`:

```tsx
import { STRINGS } from '../strings'

// was: Not yet identified · {gaps.length}
<h2 style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
  {STRINGS.registerHeading(gaps.length)}
</h2>

// was: Nothing outstanding. Add a place or run a scan to find more.
<p style={{ fontSize: 12, color: '#9C978E' }}>{STRINGS.registerEmpty}</p>
```

In `MapView.tsx`, `{n.count} places` becomes `{STRINGS.placesInGroup(n.count ?? 0)}`, and the centre
label uses `STRINGS.people`.

- [ ] **Step 7: Wire history into `App.tsx`**

Replace the `project` state with a history, and add the two buttons:

```tsx
import { initHistory, push, undo, redo, canUndo, canRedo } from '../core/history'
import { STRINGS } from './strings'

const [history, setHistory] = useState(() =>
  initHistory(createEmptyProject(STRINGS.untitled, new Date().toISOString())),
)
const project = history.present

// replacing setProject(p):
const setProject = (next: Project) => setHistory((h) => push(h, next))

// in the header, after Save:
<button disabled={!canUndo(history)} onClick={() => setHistory(undo)}>{STRINGS.undo}</button>
<button disabled={!canRedo(history)} onClick={() => setHistory(redo)}>{STRINGS.redo}</button>
```

Opening a project replaces the history rather than pushing onto it — a freshly opened file has no
past: `setHistory(initHistory(p))`.

- [ ] **Step 8: Add the string-literal guard**

```ts
// tests/renderer/noLooseStrings.test.ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

describe('renderer strings', () => {
  it('has no display text outside strings.ts', () => {
    // JSX text nodes of two or more words, anywhere but strings.ts.
    const cmd =
      'grep -rEn ">[[:space:]]*[A-Z][a-z]+ [a-z]" src/renderer --include=*.tsx ' +
      '--exclude=strings.ts || true'
    const hits = execSync(cmd).toString().trim()
    expect(hits).toBe('')
  })
})
```

- [ ] **Step 9: Run everything**

Run: `npm test && npm run typecheck`
Expected: all suites pass, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/core/history.ts src/renderer tests/core/history.test.ts tests/renderer/noLooseStrings.test.ts
git commit -m "feat: undo/redo history and a single strings module"
```

---

## Task 15: Packaging for macOS and Windows

**Files:**
- Create: `electron-builder.yml`, `docs/INSTALL.md`
- Create: `src/main/log.ts`
- Modify: `package.json`, `src/main/index.ts`
- Test: `tests/main/log.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `writeCrashLine(dir: string, line: string): Promise<void>` — appends to a local log, never uploads
  - `npm run dist` produces a `.dmg` and an `.exe` installer

Two things belong together here. §7 forbids crash reporting, so an unhandled error must go somewhere the user can find and choose to share — a local file with no project content in it. And the app has to become an artefact you can attach to a GitHub release.

- [ ] **Step 1: Write the failing log test**

```ts
// tests/main/log.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeCrashLine } from '../../src/main/log'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'traccia-log-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('writeCrashLine', () => {
  it('creates the log file and appends a line', async () => {
    await writeCrashLine(dir, 'boom')
    expect(await readFile(join(dir, 'traccia.log'), 'utf8')).toContain('boom')
  })

  it('appends rather than replacing', async () => {
    await writeCrashLine(dir, 'first')
    await writeCrashLine(dir, 'second')
    const text = await readFile(join(dir, 'traccia.log'), 'utf8')
    expect(text).toContain('first')
    expect(text).toContain('second')
  })

  it('never records more than 200 characters of a message', async () => {
    await writeCrashLine(dir, 'x'.repeat(5000))
    const text = await readFile(join(dir, 'traccia.log'), 'utf8')
    expect(text.length).toBeLessThan(400)
  })
})
```

The truncation rule exists so a stack trace containing a place name or a file path cannot turn the log
into a copy of the user's data.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/main/log.test.ts`
Expected: FAIL — cannot resolve `../../src/main/log`.

- [ ] **Step 3: Write `src/main/log.ts`**

```ts
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_MESSAGE = 200

/**
 * Appends one line to a local log the user can find and choose to share.
 * Nothing is ever uploaded. Messages are truncated so a stack trace cannot
 * carry project content into the file.
 */
export async function writeCrashLine(dir: string, line: string): Promise<void> {
  const stamp = new Date().toISOString()
  const safe = line.slice(0, MAX_MESSAGE)
  await appendFile(join(dir, 'traccia.log'), `${stamp} ${safe}\n`, 'utf8')
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/main/log.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire it into `src/main/index.ts`**

Add near the top of `app.whenReady()`:

```ts
import { app } from 'electron'
import { writeCrashLine } from './log'

process.on('uncaughtException', (err) => {
  void writeCrashLine(app.getPath('userData'), `uncaught: ${err.message}`)
})
process.on('unhandledRejection', (reason) => {
  void writeCrashLine(app.getPath('userData'), `unhandled: ${String(reason)}`)
})
```

- [ ] **Step 6: Write `electron-builder.yml`**

```yaml
appId: com.traccia.app
productName: Traccia
directories:
  output: release
files:
  - out/**/*
  - package.json
mac:
  target: dmg
  category: public.app-category.business
  # Unsigned in v1. To sign later, add:
  #   identity: "Developer ID Application: NAME (TEAMID)"
  #   notarize: true
  identity: null
win:
  target: nsis
  # Unsigned in v1. To sign later, add certificateFile and certificatePassword
  # via CI secrets — never commit a certificate.
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 7: Add the packaging scripts**

```json
{
  "scripts": {
    "dist": "electron-vite build && electron-builder --mac --win",
    "dist:mac": "electron-vite build && electron-builder --mac",
    "dist:win": "electron-vite build && electron-builder --win"
  }
}
```

Install the builder: `npm i -D electron-builder`

- [ ] **Step 8: Write `docs/INSTALL.md`**

```markdown
# Installing Traccia

Traccia is free and unsigned. Because it is unsigned, both operating systems will warn you the first
time you open it. Here is exactly what you will see and why.

## macOS

1. Open the `.dmg` and drag Traccia to Applications.
2. The first launch shows "Traccia cannot be opened because the developer cannot be verified."
3. Right-click the app, choose **Open**, then **Open** again in the dialog.
4. This is needed once.

## Windows

1. Run the `.exe`.
2. SmartScreen shows "Windows protected your PC."
3. Click **More info**, then **Run anyway**.

## Why the warnings

Signing an application requires paid certificates from Apple and a certificate authority. Traccia is
free and not signed yet. The warnings mean the operating system cannot confirm who published the app —
not that anything is wrong with it. Download only from the project's GitHub releases page.

## What Traccia sends over the network

Nothing, except when you explicitly scan a website address you have typed in. There is no telemetry,
no crash reporting, no update check, and no account. If the app hits an unexpected error it writes a
short line to a local log file and nothing else. You can find that log at:

- macOS: `~/Library/Application Support/Traccia/traccia.log`
- Windows: `%APPDATA%\Traccia\traccia.log`
```

- [ ] **Step 9: Build and check**

Run: `npm run dist:mac`
Expected: a `.dmg` appears in `release/`. Install it, open it following the steps in `INSTALL.md`, and
confirm the app runs.

If you have a Windows machine or VM available, run `npm run dist:win` there and repeat. If not, note
in the commit that the Windows installer is untested and test it before the first release.

- [ ] **Step 10: Commit**

```bash
git add electron-builder.yml docs/INSTALL.md src/main/log.ts tests/main/log.test.ts package.json src/main/index.ts
git commit -m "feat: packaging for macos and windows, local crash log, install guide"
```

---

## Self-review

Checked against the spec:

- §4 entity model — Tasks 2, 4, 5
- §4.4 gaps, three kinds — Tasks 6, 7, 8, 9
- §5.3 merge rules — Task 8
- §5.4 expectation library, twelve functions — Task 7
- §6.1 map, grouped, with counters — Tasks 10, 13
- §6.2 register — Task 13
- §7 privacy, enforced by test — Tasks 11, 12, 13
- §8 stack and JSON project file — Tasks 1, 12
- §9 testing, three weighted suites — gaps (6–9), merge (8), egress (11)
- §10 v1 scope — scanner, document reader and export are Phases 2–4 per the roadmap
- §8.1 platforms, language, distribution — Tasks 14 (strings) and 15 (packaging, crash log, install guide)
- §8.1 Windows file writes — Task 12 retry loop and overwrite tests

Type consistency verified: `Project`, `Place`, `Flow`, `Gap`, `Observation` and `LayoutResult` keep the same shape across every task that touches them. `computeGaps`, `computeLayout`, `mergeObservations`, `validateProject`, `readProjectFile`, `writeProjectFile`, `decideEgress` and `installEgressGuard` are each defined once and referenced by those exact names.

Known and deliberate: §6.3 leaves the visual direction open, so Task 13 uses minimal inline styles. Replacing them is a styling pass, not a rewrite — the components take a `LayoutResult` and a `Gap[]` regardless of how they are painted.
