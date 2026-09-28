import type { Transform } from './model'

export type AlignmentGuide = { axis: 'x' | 'y'; position: number; start: number; end: number }
type Axis = 'x' | 'y'
type Match = { delta: number; target: number; reference: Transform }

const anchors = (bounds: Transform, axis: Axis) => {
  const start = axis === 'x' ? bounds.x : bounds.y
  const size = axis === 'x' ? bounds.width : bounds.height
  return [start, start + size / 2, start + size]
}

function closestMatch(bounds: Transform, references: Transform[], axis: Axis, zoom: number, resize: boolean): Match | null {
  const moving = anchors(bounds, axis)
  const threshold = 8 / zoom
  let best: Match | null = null
  for (const reference of references) {
    for (const position of resize ? [moving[2]] : moving) {
      for (const target of anchors(reference, axis)) {
        const delta = target - position
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, target, reference }
      }
    }
  }
  return best
}

function guide(bounds: Transform, match: Match, axis: Axis): AlignmentGuide {
  const reference = match.reference
  return axis === 'x'
    ? { axis, position: match.target, start: Math.min(bounds.y, reference.y), end: Math.max(bounds.y + bounds.height, reference.y + reference.height) }
    : { axis, position: match.target, start: Math.min(bounds.x, reference.x), end: Math.max(bounds.x + bounds.width, reference.x + reference.width) }
}

export function snapMove(bounds: Transform, references: Transform[], zoom: number): { bounds: Transform; guides: AlignmentGuide[] } {
  const x = closestMatch(bounds, references, 'x', zoom, false)
  const y = closestMatch(bounds, references, 'y', zoom, false)
  const next = { ...bounds, x: bounds.x + (x?.delta || 0), y: bounds.y + (y?.delta || 0) }
  const guides: AlignmentGuide[] = []
  if (x) guides.push(guide(next, x, 'x'))
  if (y) guides.push(guide(next, y, 'y'))
  return { bounds: next, guides }
}

export function snapResize(bounds: Transform, references: Transform[], zoom: number, minWidth: number, minHeight: number, aspectRatio?: number): { bounds: Transform; guides: AlignmentGuide[] } {
  const x = closestMatch(bounds, references, 'x', zoom, true)
  const y = closestMatch(bounds, references, 'y', zoom, true)
  const next = { ...bounds }
  const guides: AlignmentGuide[] = []
  if (aspectRatio) {
    const useX = x && (!y || Math.abs(x.delta) <= Math.abs(y.delta))
    if (useX && (bounds.width + x.delta) >= minWidth) {
      next.width += x.delta
      next.height = next.width / aspectRatio
      guides.push(guide(next, x, 'x'))
    } else if (y && (bounds.height + y.delta) * aspectRatio >= minWidth) {
      next.height += y.delta
      next.width = next.height * aspectRatio
      guides.push(guide(next, y, 'y'))
    }
  } else {
    if (x && bounds.width + x.delta >= minWidth) { next.width += x.delta; guides.push(guide(next, x, 'x')) }
    if (y && bounds.height + y.delta >= minHeight) { next.height += y.delta; guides.push(guide(next, y, 'y')) }
  }
  return { bounds: next, guides }
}
