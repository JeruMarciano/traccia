import { addPlace } from './graph'
import type { Observation, Place, Project } from './types'

// A domain is "accounted for" only when it exactly matches a place's jurisdiction
// (the free-text field documents use to record a recipient's domain) or a place's
// name (how merge itself names a place it creates from a bare domain). Substring
// matching over the concatenated name+jurisdiction text was tried first, but an
// unrelated declared place whose free-text name or jurisdiction merely contained
// the observed domain as a substring (e.g. jurisdiction "acme.example.org"
// containing the observed domain "acme.example") would then wrongly be treated as
// accounting for it, silently swallowing a real contradiction.
function accountedFor(places: readonly Place[], domain: string): Place | undefined {
  const needle = domain.toLowerCase()
  return places.find(
    (p) => (p.jurisdiction ?? '').toLowerCase() === needle || p.name.toLowerCase() === needle,
  )
}

// The next id in idPrefix's sequence that isn't already taken in this project.
// Callers are expected to reuse the same idPrefix across repeated merges (one
// per scan); scanning existing ids instead of counting from zero each call means
// a second call never proposes an id the first call already handed out.
function nextPlaceId(project: Project, idPrefix: string): string {
  let n = 1
  while (project.places.some((p) => p.id === `${idPrefix}-${n}`)) {
    n += 1
  }
  return `${idPrefix}-${n}`
}

export function mergeObservations(
  project: Project,
  observations: Observation[],
  idPrefix: string,
): Project {
  let working = project

  for (const o of observations) {
    const match = accountedFor(working.places, o.domain)
    if (match) {
      // Seeing it confirms it exists. Every other field a human or document set is left alone.
      working = {
        ...working,
        places: working.places.map((p) =>
          p.id === match.id ? { ...p, confidence: 'observed' } : p,
        ),
      }
      continue
    }
    // Routed through addPlace so its duplicate-id guard applies here too: if
    // nextPlaceId's scan and this insert ever disagreed, this throws instead of
    // silently producing two Place objects that share one id.
    working = addPlace(
      working,
      {
        name: o.domain,
        kind: 'unknown',
        purposeGroup: 'Systems',
        holder: 'unknown',
        leavesEEA: 'unknown',
        sources: [],
        confidence: 'observed',
      },
      nextPlaceId(working, idPrefix),
    )
  }

  const seen = new Set(project.observations.map((o) => o.domain))
  const fresh = observations.filter((o) => !seen.has(o.domain))

  return { ...working, observations: [...project.observations, ...fresh] }
}
