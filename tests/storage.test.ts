import { beforeEach, expect, test } from 'vitest'
import { openDB } from 'idb'
import { deleteBoard, listBoards, loadAsset, loadBoard, saveAsset, saveBoard } from '../src/storage'
import { blank, image } from './fixtures'

beforeEach(async () => {
  const db = await openDB('spatial-learning-board', 1)
  await db.clear('boards')
  await db.clear('assets')
  db.close()
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
