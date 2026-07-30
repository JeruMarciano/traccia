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
