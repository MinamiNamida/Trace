import { openDB } from 'idb'
import type { Board } from './model'

const db = openDB('spatial-learning-board', 1, {
  upgrade(database) {
    database.createObjectStore('boards')
    database.createObjectStore('assets')
  },
})

export async function saveBoard(board: Board) { await (await db).put('boards', { ...board, version: 2 }, board.id) }
export async function loadBoard(id = 'main'): Promise<Board | undefined> {
  const board = await (await db).get('boards', id) as Board | undefined
  return board && board.version < 2 ? { ...board, version: 2, stories: board.stories || {} } : board
}
export async function listBoards(): Promise<{ id: string; title: string }[]> { return (await (await db).getAll('boards') as Board[]).map(board => ({ id: board.id, title: board.title })) }
export async function deleteBoard(id: string) {
  const transaction = (await db).transaction(['boards', 'assets'], 'readwrite')
  const boards = transaction.objectStore('boards')
  const existing = await boards.getAll() as Board[]
  const deleted = existing.find(board => board.id === id)
  const retainedAssets = new Set(existing.filter(board => board.id !== id).flatMap(board => Object.values(board.items).flatMap(item => item.type === 'image' ? [item.assetId] : [])))
  await boards.delete(id)
  if (deleted) {
    for (const item of Object.values(deleted.items)) {
      if (item.type === 'image' && !retainedAssets.has(item.assetId)) await transaction.objectStore('assets').delete(item.assetId)
    }
  }
  await transaction.done
}
export async function saveAsset(id: string, blob: Blob) { await (await db).put('assets', blob, id) }
export async function loadAsset(id: string): Promise<Blob | undefined> { return (await db).get('assets', id) }
