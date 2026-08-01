import type { Flow, Place, Project } from './types'

function knownIds(project: Project): Set<string> {
  return new Set<string>([
    ...project.places.map((p) => p.id),
    ...project.subjectGroups.map((s) => s.id),
  ])
}

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
