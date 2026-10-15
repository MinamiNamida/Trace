import { beforeEach, expect, test } from 'vitest'
import { openDB } from 'idb'
import { clearStorage, deleteBoard, listBoards, loadAsset, loadBoard, saveAsset, saveBoard } from '../src/storage'
import { blank, image } from './fixtures'

beforeEach(async () => {
  await clearStorage()
})

test('deletion removes a board and its private assets while preserving shared images and other boards', async () => {
  const first = blank('first'), second = blank('second')
  first.items = { shared: image('shared', 'shared-asset'), private: image('private', 'private-asset') }
  second.items = { shared: image('shared', 'shared-asset') }
  await saveBoard(first)
  await saveBoard(second)
  await saveAsset('shared-asset', new Blob(['shared']))
  await saveAsset('private-asset', new Blob(['private']))
  await deleteBoard(first.id)
  expect(await loadBoard(first.id)).toBeUndefined()
  expect(await loadAsset('private-asset')).toBeUndefined()
  expect(await loadAsset('shared-asset')).toBeDefined()
  expect(await loadBoard(second.id)).toEqual(second)
  await deleteBoard(second.id)
  expect(await listBoards()).toEqual([])
  expect(await loadAsset('shared-asset')).toBeUndefined()
  await deleteBoard('missing')
})

test('a save already in flight completes before deletion, without resurrecting the board', async () => {
  const board = blank('pending')
  await Promise.all([saveBoard(board), deleteBoard(board.id)])
  expect(await loadBoard(board.id)).toBeUndefined()
})

test('pen strokes round-trip through storage unchanged, and undo removes the stroke', async () => {
  const board = blank('pen')
  board.items = { s: { id: 's', type: 'drawing', lineWidth: 1.25, pen: { mode: 'technical', smoothing: .2, pressure: false, curve: 1 }, transform: { x: 1.5, y: 2.5, width: 3, height: 3 }, points: [{ x: 0, y: 0, pressure: .3, t: 0 }, { x: 3.125, y: 3.0625, t: 7 }] } }
  await saveBoard(board)
  expect(await loadBoard('pen')).toEqual(board)
})

const stroke = (id: string, x: number) => ({ id, type: 'drawing' as const, lineWidth: 2, transform: { x: 0, y: 0, width: 5, height: 5 }, points: [{ x: 0, y: 0 }, { x, y: x }] })
const rawStore = async (name: 'boards' | 'strokes') => { const raw = await openDB('spatial-learning-board', 2); const all = await raw.getAll(name); const keys = await raw.getAllKeys(name); raw.close(); return { all, keys } }

test('strokes live in their own records and a save only rewrites strokes that changed', async () => {
  const board = blank('inc')
  board.items = { a: stroke('a', 3), b: stroke('b', 4) }
  await saveBoard(board)
  expect((await rawStore('boards')).all[0].items.a.points).toEqual([])
  expect((await rawStore('strokes')).keys).toHaveLength(2)

  const raw = await openDB('spatial-learning-board', 2)
  await raw.put('strokes', [{ x: 99, y: 99 }], ['inc', 'a'])
  raw.close()
  const next = { ...board, title: 'renamed', items: { a: board.items.a, b: stroke('b', 8) } }
  await saveBoard(next)
  const loaded = await loadBoard('inc')
  expect((loaded!.items.a as { points: unknown[] }).points).toEqual([{ x: 99, y: 99 }]) // untouched stroke was not rewritten
  expect((loaded!.items.b as { points: { x: number }[] }).points[1].x).toBe(8)
  expect(loaded!.title).toBe('renamed')

  await saveBoard({ ...next, items: { b: next.items.b } })
  expect((await rawStore('strokes')).keys).toEqual([['inc', 'b']])
  await deleteBoard('inc')
  expect((await rawStore('strokes')).keys).toHaveLength(0)
})

test('a board saved in the old inline format loads, and its next save moves strokes out', async () => {
  const legacy = { ...blank('old'), items: { a: stroke('a', 3) } }
  const raw = await openDB('spatial-learning-board', 2)
  await raw.put('boards', legacy, 'old')
  raw.close()
  const loaded = (await loadBoard('old'))!
  expect(loaded).toEqual(legacy)
  await saveBoard(loaded)
  expect((await rawStore('strokes')).keys).toEqual([['old', 'a']])
  expect(await loadBoard('old')).toEqual(legacy)
})
