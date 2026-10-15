import { beforeEach, expect, test } from 'vitest'
import { createBackup, restoreBackup } from '../src/backup'
import { clearStorage, loadAsset, saveAsset } from '../src/storage'
import { blank, image } from './fixtures'

beforeEach(async () => { await clearStorage() })

test('a backup restores strokes and images into a new board without touching the original', async () => {
  const board = blank('orig')
  board.title = 'Notes'
  board.items = {
    img: image('img', 'asset-1'),
    s: { id: 's', type: 'drawing', lineWidth: 1.5, transform: { x: 1, y: 2, width: 3, height: 3 }, points: [{ x: 0, y: 0, t: 0 }, { x: 3, y: 3, t: 5 }] },
  }
  await saveAsset('asset-1', new Blob(['png-bytes'], { type: 'image/png' }))
  const text = await (await createBackup(board)).text()
  await clearStorage()
  const restored = await restoreBackup(text)
  expect(restored.id).not.toBe('orig')
  expect(restored.title).toBe('Notes (imported)')
  expect(restored.items).toEqual(board.items)
  expect(await loadAsset('asset-1')).toBeDefined()
})

test('files that are not backups are rejected', async () => {
  await expect(restoreBackup('not json')).rejects.toThrow('not a Trace backup')
  await expect(restoreBackup(JSON.stringify({ format: 'trace/board-backup', version: 1, board: { items: {}, frames: {}, frameEdges: {}, stories: {} } }))).resolves.toBeDefined()
  await expect(restoreBackup(JSON.stringify({ format: 'other' }))).rejects.toThrow()
  await expect(restoreBackup(JSON.stringify({ format: 'trace/board-backup', version: 1, board: { items: { a: { id: 'a', type: 'drawing', transform: {}, points: [{ x: NaN, y: 0 }] } }, frames: {}, frameEdges: {}, stories: {} } }))).rejects.toThrow()
})
