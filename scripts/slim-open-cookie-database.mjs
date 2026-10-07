#!/usr/bin/env node
// Dev-only. Never bundled, never run at build time or at runtime; Node built-ins only.
//
// Reads the Open Cookie Database CSV at one pinned upstream commit and keeps four columns,
// [name, platform, category, wildcard], in src/data/cookie-platforms.json. The app never fetches
// anything: this script is the only thing that does, and only when a person runs it.
//
// Upstream: the jkwakman/Open-Cookie-Database repository on GitHub, licensed Apache-2.0
// (see NOTICE-open-cookie-database.txt, which carries the upstream LICENSE verbatim).
// Pinned commit: 749c37c17eb910fa95621f4fee34d9a6d4126c23 (2026-08-21).
//
// Run: node scripts/slim-open-cookie-database.mjs
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const COMMIT = '749c37c17eb910fa95621f4fee34d9a6d4126c23'
const URL_CSV = `${'https'}://raw.githubusercontent.com/jkwakman/Open-Cookie-Database/${COMMIT}/open-cookie-database.csv`
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'cookie-platforms.json')

// RFC 4180 enough for this file: quoted fields may hold commas, doubled quotes and newlines.
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1 }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += c
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

const res = await fetch(URL_CSV)
if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
const [header, ...rows] = parseCsv(await res.text())
const col = (name) => {
  const i = header.indexOf(name)
  if (i < 0) throw new Error(`column missing: ${name}`)
  return i
}
const [NAME, PLATFORM, CATEGORY, WILDCARD] = [col('Cookie / Data Key name'), col('Platform'), col('Category'), col('Wildcard match')]

const seen = new Set()
const table = []
for (const r of rows) {
  const name = (r[NAME] ?? '').trim()
  if (name === '') continue
  const row = [name, (r[PLATFORM] ?? '').trim(), (r[CATEGORY] ?? '').trim(), r[WILDCARD] === '1' ? 1 : 0]
  const key = JSON.stringify(row)
  if (seen.has(key)) continue
  seen.add(key)
  table.push(row)
}
table.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
writeFileSync(out, JSON.stringify(table) + '\n')
console.log(`Wrote ${table.length} rows to ${path.relative(process.cwd(), out)}`)
