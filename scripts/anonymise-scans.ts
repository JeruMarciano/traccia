// Turns real bench scans into fixtures that name nobody. Run by hand, once per fixture change:
//   npx vite-node scripts/anonymise-scans.ts <runs-dir> <map.json> tests/fixtures/scans
// The runs and the map live outside the repository, because both name real organisations.
// Suppliers' names stay: they are what the map is about.
import fs from 'node:fs'
import path from 'node:path'
import { deriveDoors } from '../src/core/doors'
import { ingestScan } from '../src/core/scan'
import type { CookiePlatformRow, Project, ScanResult, VendorDictionary } from '../src/core/types'
import cookiePlatforms from '../src/data/cookie-platforms.json'
import vendors from '../src/data/vendors.json'

interface Rule {
  out: string
  /** Real registrable domain -> stand-in. Applied first, so the TLD changes with the name. */
  hosts: Record<string, string>
  /** Any other spelling of a proper name, anywhere in the file -> stand-in. */
  tokens: Record<string, string>
  /** Path prefixes whose next segment is a listing's own title: replaced by item-1, item-2, ... */
  slugPrefixes: string[]
  /** Field names (a regular expression) whose labels are a list of local place names. */
  labelNames: string
}

const [runsDir, mapFile, outDir] = process.argv.slice(2)
if (runsDir === undefined || mapFile === undefined || outDir === undefined) {
  throw new Error('usage: anonymise-scans.ts <runs-dir> <map.json> <out-dir>')
}
const rules = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as Record<string, Rule>

const literal = (s: string): RegExp => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
/** An id a third party issued to this one site: a pixel, a cart, a site key, an analytics property. */
const scrubIds = (s: string, analytics: Map<string, string>): string =>
  s
    .replace(/[0-9a-f]{16,}/gi, (m) => '0'.repeat(m.length))
    .replace(/\d{6,}/g, (m) => '0'.repeat(m.length))
    // An analytics property keeps its length and prefix; each distinct one gets its own counter, in order of appearance. Last, so the counter's zeros are not zeroed again.
    .replace(/(_ga_|\bG-)[A-Z0-9]{8,12}\b/g, (m, p: string) => {
      if (!analytics.has(m)) analytics.set(m, p + String(analytics.size + 1).padStart(m.length - p.length, '0'))
      return analytics.get(m) as string
    })

function anonymise(real: string, rule: Rule): ScanResult {
  let text = real
  const swaps = [
    ...Object.entries(rule.hosts),
    ...Object.entries(rule.tokens).sort((a, b) => b[0].length - a[0].length),
  ]
  for (const [from, to] of swaps) text = text.replace(literal(from), to)
  const scan = JSON.parse(text) as ScanResult

  const slugs = new Map<string, string>()
  const analytics = new Map<string, string>()
  const reslug = (url: string): string => {
    for (const prefix of rule.slugPrefixes) {
      const at = url.indexOf(prefix)
      if (at === -1) continue
      const rest = url.slice(at + prefix.length)
      const slug = rest.split(/[/?#]/)[0] ?? ''
      if (slug === '') continue
      if (!slugs.has(slug)) slugs.set(slug, `item-${slugs.size + 1}`)
      return url.slice(0, at + prefix.length) + slugs.get(slug) + rest.slice(slug.length)
    }
    return url
  }
  for (const p of scan.pages ?? []) p.page = reslug(p.page)
  for (const f of scan.formFields) f.page = reslug(f.page)
  for (const f of scan.iframes ?? []) f.page = reslug(f.page)
  for (const l of scan.offsiteLinks ?? []) l.page = reslug(l.page)

  if (rule.labelNames !== '') {
    const named = new RegExp(rule.labelNames)
    for (const f of scan.formFields) if (named.test(f.name)) f.label = `Option ${f.name.replace(/\D/g, '')}`
  }
  for (const k of scan.storageKeys ?? []) k.key = scrubIds(k.key, analytics)
  for (const c of scan.cookies ?? []) c.name = scrubIds(c.name, analytics)
  for (const h of scan.hosts) {
    h.host = h.host.replace(/^[0-9a-f]{10,}(?=\.)/i, (m) => '0'.repeat(m.length))
    if (h.paths !== undefined) h.paths = h.paths.map((x) => scrubIds(x, analytics))
  }
  return scan
}

function project(scan: ScanResult): Project {
  const empty: Project = {
    schemaVersion: 1,
    name: 'fixture',
    createdAt: '2026-10-12T00:00:00.000Z',
    purposeGroups: [],
    subjectGroups: [],
    places: [],
    flows: [],
    observations: [],
  }
  return ingestScan(
    empty,
    scan,
    vendors as VendorDictionary,
    { prefix: 'scan1' },
    cookiePlatforms as unknown as readonly CookiePlatformRow[],
  )
}

/** What ends up on the map, with every name left out. The real scan and its stand-in must agree. */
function shape(p: Project): string {
  const groups = new Map<string, number[]>()
  for (const place of p.places) {
    const g = groups.get(place.purposeGroup) ?? [0, 0]
    groups.set(place.purposeGroup, [(g[0] ?? 0) + 1, (g[1] ?? 0) + (place.kind === 'unknown' ? 1 : 0)])
  }
  return JSON.stringify({
    doors: deriveDoors(p).map((d) => d.kind ?? 'place'),
    groups: [...groups].sort(),
    flows: p.flows.length,
    cookies: (p.cookies ?? []).length,
    fields: (p.collectionPoints ?? []).map((cp) => cp.fields.length),
  })
}

for (const [run, rule] of Object.entries(rules)) {
  const real = fs.readFileSync(path.join(runsDir, `${run}.scan.json`), 'utf8')
  const scan = anonymise(real, rule)
  const out = JSON.stringify(scan)
  for (const name of [...Object.keys(rule.hosts), ...Object.keys(rule.tokens)]) {
    if (literal(name).test(out)) throw new Error(`run ${run}: a real name survived anonymisation`)
  }
  if (/_ga_(?!\d+\b)[A-Z0-9]{8,12}\b|\bG-(?!\d+\b)[A-Z0-9]{8,12}\b/.test(out)) {
    throw new Error(`run ${run}: an analytics property id survived anonymisation`)
  }
  const before = shape(project(JSON.parse(real) as ScanResult))
  const after = shape(project(scan))
  if (before !== after) throw new Error(`run ${run}: the stand-in draws a different map\n real ${before}\n anon ${after}`)
  fs.writeFileSync(path.join(outDir, `${rule.out}.scan.json`), out + '\n')
  console.log(`${rule.out}: ${after}`)
}
