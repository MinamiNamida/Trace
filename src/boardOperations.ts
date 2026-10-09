import { uid, unionBounds } from './model'
import type { Board, CanvasItem, Frame, FrameEdge, Id, Selection, Transform } from './model'

export const objectFor = (board: Board, id: Id) => board.items[id] || board.frames[id]
export const boundsFor = (board: Board, id: Id): Transform | undefined => board.items[id]?.transform || board.frames[id]?.bounds
export const selectedIds = (selection: Selection, multi: Id[]) => multi.length ? multi : selection && selection.kind !== 'edge' ? [selection.id] : []
export const selectionBounds = (board: Board, ids: Id[]) => unionBounds(ids.map(id => boundsFor(board, id)).filter((value): value is Transform => !!value))
export const frameChildren = (board: Board, id: Id) => Object.values(board.items).filter(item => item.frameId === id).map(item => item.id)
export const contains = (a: Transform, b: Transform) => b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height

export function expandGroups(board: Board, ids: Id[]): Id[] {
  const groups = new Set(ids.flatMap(id => objectFor(board, id)?.groupIds?.slice(-1) || []))
  return [...new Set([...ids.filter(id => !!objectFor(board, id)), ...[...Object.values(board.items), ...Object.values(board.frames)].filter(object => object.groupIds?.some(id => groups.has(id))).map(object => object.id)])]
}
export function withFrameChildren(board: Board, ids: Id[]): Id[] {
  return [...new Set([...ids, ...ids.flatMap(id => board.frames[id] ? frameChildren(board, id) : [])])]
}
export function rootIds(board: Board, ids: Id[]) {
  return ids.filter(id => !!objectFor(board, id) && (!board.items[id]?.frameId || !ids.includes(board.items[id].frameId!)))
}
export function canGroup(board: Board, ids: Id[]) {
  const roots = rootIds(board, ids)
  if (roots.length < 2) return false
  const group = objectFor(board, roots[0])?.groupIds?.at(-1)
  return !group || !roots.every(id => objectFor(board, id)?.groupIds?.at(-1) === group)
}
export const selectedGroups = (board: Board, ids: Id[]) => [...new Set(ids.flatMap(id => objectFor(board, id)?.groupIds?.slice(-1) || []))]
export function groupObjects(board: Board, ids: Id[]) {
  if (!canGroup(board, ids)) return
  const roots = rootIds(board, expandGroups(board, ids))
  const parentFrames = new Set(roots.map(id => board.items[id]?.frameId))
  const groupId = uid()
  for (const id of roots) {
    const object = objectFor(board, id)
    object.groupIds = [...(object.groupIds || []), groupId]
    if (board.items[id] && parentFrames.size > 1) delete board.items[id].frameId
  }
}
export function ungroupObjects(board: Board, ids: Id[]) {
  const groups = new Set(selectedGroups(board, ids))
  for (const object of [...Object.values(board.items), ...Object.values(board.frames)]) {
    object.groupIds = object.groupIds?.filter(id => !groups.has(id))
    if (!object.groupIds?.length) delete object.groupIds
  }
}

// Assign a complete group together. Items overlapping frame boundaries stay outside.
export function reconcileFrames(board: Board, ids = Object.keys(board.items)) {
  const candidates = expandGroups(board, ids).filter(id => !!board.items[id])
  const seen = new Set<Id>()
  const frames = Object.values(board.frames).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)
  for (const id of candidates) {
    if (seen.has(id)) continue
    const members = expandGroups(board, [id])
    members.forEach(member => seen.add(member))
    const bounds = selectionBounds(board, members)
    const frame = !members.some(member => !!board.frames[member]) && bounds ? frames.find(frame => contains(frame.bounds, bounds)) : undefined
    for (const member of members) if (board.items[member]) {
      if (frame) board.items[member].frameId = frame.id
      else delete board.items[member].frameId
    }
  }
}
export function reconcileFrame(board: Board, frameId: Id) {
  const frame = board.frames[frameId]
  if (!frame) return
  reconcileFrames(board, [...frameChildren(board, frameId), ...Object.values(board.items).filter(item => contains(frame.bounds, item.transform)).map(item => item.id)])
}
export function wrapInFrame(board: Board, ids: Id[]) {
  if (!ids.length || ids.some(id => !!board.frames[id])) return null
  const bounds = selectionBounds(board, ids)
  if (!bounds) return null
  const id = uid()
  board.frames[id] = { id, title: 'Untitled frame', bounds: { x: bounds.x - 32, y: bounds.y - 48, width: bounds.width + 64, height: bounds.height + 80 } }
  for (const itemId of ids) if (board.items[itemId]) board.items[itemId].frameId = id
  return id
}
export function removeObjects(board: Board, ids: Id[], includeContents = true) {
  const removed = new Set(includeContents ? withFrameChildren(board, ids) : ids)
  for (const id of removed) { delete board.items[id]; delete board.frames[id]; delete board.frameEdges[id] }
  for (const item of Object.values(board.items)) if (item.frameId && removed.has(item.frameId)) delete item.frameId
  for (const edge of Object.values(board.frameEdges)) if (removed.has(edge.from) || removed.has(edge.to)) delete board.frameEdges[edge.id]
  for (const story of Object.values(board.stories)) {
    story.steps = story.steps.filter(step => !removed.has(step.frameId))
    for (const step of story.steps) {
      if (step.visibleItems) step.visibleItems = step.visibleItems.filter(id => !removed.has(id))
      if (step.revealItems) step.revealItems = step.revealItems.filter(id => !removed.has(id))
    }
  }
  const counts = new Map<Id, number>()
  for (const object of [...Object.values(board.items), ...Object.values(board.frames)]) for (const group of object.groupIds || []) counts.set(group, (counts.get(group) || 0) + 1)
  for (const object of [...Object.values(board.items), ...Object.values(board.frames)]) {
    if (object.groupIds) object.groupIds = object.groupIds.filter(group => (counts.get(group) || 0) > 1)
    if (!object.groupIds?.length) delete object.groupIds
  }
}

export type BoardClip = { kind: 'trace/selection'; version: 1; items: CanvasItem[]; frames: Frame[]; edges: FrameEdge[]; assets?: Record<Id, string> }
export function createClip(board: Board, ids: Id[], edgeId?: Id): BoardClip {
  const all = new Set(withFrameChildren(board, ids))
  return structuredClone({ kind: 'trace/selection', version: 1, items: Object.values(board.items).filter(item => all.has(item.id)), frames: Object.values(board.frames).filter(frame => all.has(frame.id)), edges: Object.values(board.frameEdges).filter(edge => edge.id === edgeId || (all.has(edge.from) && all.has(edge.to))) })
}
export function insertClip(board: Board, clip: BoardClip, at?: { x: number; y: number }) {
  const objects = [...clip.items, ...clip.frames]
  const bounds = unionBounds(objects.map(object => 'transform' in object ? object.transform : object.bounds))
  if (!bounds) return []
  const ids = new Map(objects.map(object => [object.id, uid()]))
  const groups = new Map<Id, Id>()
  const counts = new Map<Id, number>()
  for (const object of objects) for (const group of object.groupIds || []) counts.set(group, (counts.get(group) || 0) + 1)
  const dx = at ? at.x - bounds.x : 26, dy = at ? at.y - bounds.y : 26
  for (const original of objects) {
    const object = structuredClone(original)
    object.id = ids.get(original.id)!
    object.groupIds = object.groupIds?.filter(group => (counts.get(group) || 0) > 1).map(group => { if (!groups.has(group)) groups.set(group, uid()); return groups.get(group)! })
    if (!object.groupIds?.length) delete object.groupIds
    if ('transform' in object) {
      object.transform.x += dx; object.transform.y += dy
      if (object.frameId && ids.has(object.frameId)) object.frameId = ids.get(object.frameId)
      else delete object.frameId
      board.items[object.id] = object
    } else { object.bounds.x += dx; object.bounds.y += dy; board.frames[object.id] = object }
  }
  for (const original of clip.edges) if (ids.has(original.from) && ids.has(original.to)) {
    const id = uid(); board.frameEdges[id] = { id, from: ids.get(original.from)!, to: ids.get(original.to)! }
  }
  const inserted = [...ids.values()]
  reconcileFrames(board, inserted.filter(id => !board.items[id]?.frameId))
  return rootIds(board, inserted)
}
