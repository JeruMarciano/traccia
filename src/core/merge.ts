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
