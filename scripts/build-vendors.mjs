#!/usr/bin/env node
// Dev-only. Never ships, never runs at build time or at runtime. Reads the
// hand-authored dictionary source chosen by the Task 0 preflight (Tracker
// Radar's CC BY-NC-SA 4.0 licence forbids bundling its data, so no file from
// it is copied, transformed or shipped — see
// docs/decisions/2026-08-01-v0.1-preflight.md §3) and writes it out as the
// flat VendorDictionary shape the app loads.
//
// Category -> purpose-group mapping. The twelve categories the project
// recognises are visible in src/core/expectations.ts; this dictionary only
// ever needs the seven that a name-the-vendor lookup can plausibly produce.
// Anything not listed here falls through to "Running the systems", the
// existing default.
//
//   analytics        -> Marketing
//   advertising       -> Marketing
//   social            -> Marketing
//   tag-manager       -> Marketing
//   a-b-testing       -> Marketing
//   email-marketing   -> Marketing
//   reviews           -> Marketing
//   forms             -> Marketing
//   scheduling        -> Selling
//   crm               -> Selling
//   ecommerce         -> Selling
//   payments          -> Getting paid
//   support           -> Support
//   live-chat         -> Support
//   delivery          -> Delivering orders
//   cdn               -> Running the systems
//   hosting           -> Running the systems
//   fonts             -> Running the systems
//   maps              -> Running the systems
//   infrastructure    -> Running the systems
//   consent           -> Running the systems
//   captcha           -> Running the systems
//   error-tracking    -> Running the systems
//   performance       -> Running the systems
//   video             -> Running the systems

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(here, 'vendors-source.json')
const outPath = path.join(here, '..', 'src', 'data', 'vendors.json')

const CATEGORY_TO_PURPOSE_GROUP = {
  analytics: 'Marketing',
  advertising: 'Marketing',
  social: 'Marketing',
  'tag-manager': 'Marketing',
  'a-b-testing': 'Marketing',
  'email-marketing': 'Marketing',
  reviews: 'Marketing',
  forms: 'Marketing',
  scheduling: 'Selling',
  crm: 'Selling',
  ecommerce: 'Selling',
  payments: 'Getting paid',
  support: 'Support',
  'live-chat': 'Support',
  delivery: 'Delivering orders',
}

const DEFAULT_PURPOSE_GROUP = 'Running the systems'

const source = JSON.parse(readFileSync(sourcePath, 'utf8'))

const dictionary = {}
for (const { host, owner, category } of source) {
  const purposeGroup = CATEGORY_TO_PURPOSE_GROUP[category] ?? DEFAULT_PURPOSE_GROUP
  dictionary[host] = { owner, category, purposeGroup }
}

writeFileSync(outPath, JSON.stringify(dictionary, null, 2) + '\n')

console.log(`Wrote ${Object.keys(dictionary).length} entries to ${path.relative(process.cwd(), outPath)}`)
