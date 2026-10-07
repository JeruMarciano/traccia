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
  // The very same project is not a change (a scan whose page did not load returns it as it was),
  // and a step that changed nothing would be an Undo that visibly does nothing.
  if (next === history.present) return history
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
