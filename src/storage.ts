import { openDB } from 'idb'
import type { Board, DrawingItem } from './model'

const db = openDB('spatial-learning-board', 2, {
  upgrade(database) {
    for (const name of ['boards', 'assets', 'strokes'] as const) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name)
  },
})

/**
 * Format 3 keeps a board's stroke points out of its record: `boards` holds the board with every drawing's
 * `points` emptied, and `strokes` holds one record per drawing keyed by [boardId, itemId]. A save then only
 * writes the strokes whose object changed. Format 2 boards (points inline) still load, and are rewritten as
 * format 3 by their next save.
 */
const FORMAT = 3
const persisted = new Map<string, Map<string, DrawingItem>>()
let queue: Promise<unknown> = Promise.resolve()
const serialized = <T>(task: () => Promise<T>) => { const run = queue.then(task, task); queue = run.catch(() => {}); return run }
const strokeRange = (boardId: string) => IDBKeyRange.bound([boardId], [boardId, []])
const drawings = (board: Board) => Object.values(board.items).filter((item): item is DrawingItem => item.type === 'drawing')

export function saveBoard(board: Board) {
  return serialized(async () => {
    const known = persisted.get(board.id) ?? new Map<string, DrawingItem>()
    const current = new Map(drawings(board).map(item => [item.id, item]))
    const stripped = { ...board, version: 2, format: FORMAT, items: { ...board.items } }
    for (const item of current.values()) stripped.items[item.id] = { ...item, points: [] }
    const transaction = (await db).transaction(['boards', 'strokes'], 'readwrite')
    const strokes = transaction.objectStore('strokes')
    const writes: Promise<unknown>[] = [transaction.objectStore('boards').put(stripped, board.id)]
    for (const [id, item] of current) if (known.get(id) !== item) writes.push(strokes.put(item.points, [board.id, id]))
    for (const id of known.keys()) if (!current.has(id)) writes.push(strokes.delete([board.id, id]))
    await Promise.all([...writes, transaction.done])
    persisted.set(board.id, current)
  })
}
export async function loadBoard(id = 'main'): Promise<Board | undefined> {
  const database = await db
  const stored = await database.get('boards', id) as (Board & { format?: number }) | undefined
  if (!stored) return undefined
  const { format = 2, ...rest } = stored
  const raw: Board = rest.version < 2 ? { ...rest, version: 2, stories: rest.stories || {} } : rest
  if (format >= FORMAT) {
    const [keys, values] = await Promise.all([database.getAllKeys('strokes', strokeRange(id)), database.getAll('strokes', strokeRange(id))])
    const points = new Map(keys.map((key, index) => [(key as [string, string])[1], values[index]]))
    for (const item of drawings(raw)) item.points = points.get(item.id) ?? []
  }
  // A format 2 board has no stroke records yet, so its next save must write every stroke.
  persisted.set(id, format >= FORMAT ? new Map(drawings(raw).map(item => [item.id, item])) : new Map())
  return raw
}
export async function listBoards(): Promise<{ id: string; title: string }[]> { return (await (await db).getAll('boards') as Board[]).map(board => ({ id: board.id, title: board.title })) }
export function deleteBoard(id: string) { return serialized(() => removeBoard(id)) }
async function removeBoard(id: string) {
  const transaction = (await db).transaction(['boards', 'assets', 'strokes'], 'readwrite')
  const boards = transaction.objectStore('boards')
  const existing = await boards.getAll() as Board[]
  const deleted = existing.find(board => board.id === id)
  const retainedAssets = new Set(existing.filter(board => board.id !== id).flatMap(board => Object.values(board.items).flatMap(item => item.type === 'image' ? [item.assetId] : [])))
  await boards.delete(id)
  await transaction.objectStore('strokes').delete(strokeRange(id))
  persisted.delete(id)
  if (deleted) {
    for (const item of Object.values(deleted.items)) {
      if (item.type === 'image' && !retainedAssets.has(item.assetId)) await transaction.objectStore('assets').delete(item.assetId)
    }
  }
  await transaction.done
}
export async function saveAsset(id: string, blob: Blob) { await (await db).put('assets', blob, id) }
export async function loadAsset(id: string): Promise<Blob | undefined> { return (await db).get('assets', id) }

/** Test helper: empties every store and forgets what was persisted. */
export async function clearStorage() {
  const database = await db
  await Promise.all(['boards', 'assets', 'strokes'].map(name => database.clear(name as 'boards')))
  persisted.clear()
}
