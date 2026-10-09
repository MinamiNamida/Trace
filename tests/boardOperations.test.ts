import { expect, test } from 'vitest'
import type { Board, TextItem } from '../src/model'
import { canGroup, createClip, expandGroups, frameChildren, groupObjects, insertClip, reconcileFrames, removeObjects, ungroupObjects, withFrameChildren, wrapInFrame } from '../src/boardOperations'
import { parseClip, restoreClipAssets, writeClip } from '../src/boardClipboard'
import { loadAsset, loadBoard, saveAsset, saveBoard } from '../src/storage'
import { boardState } from '../src/store'
import { blank } from './fixtures'

export function populated(): Board {
  const board = blank('operations')
  for (const [id, x] of [['a', 20], ['b', 160], ['c', 520]] as const) board.items[id] = { id, type: 'text', text: id, fontSize: 20, transform: { x, y: 30, width: 100, height: 60 } }
  board.frames.f = { id: 'f', title: 'Frame', bounds: { x: 0, y: 0, width: 320, height: 200 } }
  reconcileFrames(board)
  board.frameMembership = true
  return board
}

test('nested groups expand on selection and ungroup only their outermost level', () => {
  const board = populated()
  groupObjects(board, ['a', 'b'])
  const inner = board.items.a.groupIds![0]
  expect(canGroup(board, ['a', 'b'])).toBe(false)
  expect(expandGroups(board, ['a'])).toEqual(['a', 'b'])
  groupObjects(board, ['a', 'b', 'c'])
  expect(board.items.a.frameId).toBeUndefined()
  expect(board.items.b.frameId).toBeUndefined()
  expect(expandGroups(board, ['c']).sort()).toEqual(['a', 'b', 'c'])
  ungroupObjects(board, ['a', 'b', 'c'])
  expect(board.items.a.groupIds).toEqual([inner])
  expect(board.items.c.groupIds).toBeUndefined()
  ungroupObjects(board, ['a', 'b'])
  expect(board.items.a.groupIds).toBeUndefined()
})

test('frames can be grouped while their children remain bound and move only once', () => {
  const board = populated()
  board.frames.other = { id: 'other', bounds: { x: 480, y: 0, width: 200, height: 200 } }
  reconcileFrames(board)
  expect(canGroup(board, ['f', 'a', 'b'])).toBe(false)
  groupObjects(board, ['f', 'other', 'a', 'b', 'c'])
  expect(expandGroups(board, ['f']).sort()).toEqual(['f', 'other'])
  expect(withFrameChildren(board, ['f', 'other', 'a']).sort()).toEqual(['a', 'b', 'c', 'f', 'other'])
  expect(board.items.a.frameId).toBe('f')
  expect(board.items.c.frameId).toBe('other')
})

test('moving a group into/out of a frame updates membership as a whole', () => {
  const board = populated()
  groupObjects(board, ['a', 'b'])
  board.items.b.transform.x = 300
  reconcileFrames(board, ['b'])
  expect(frameChildren(board, 'f')).toEqual([])
  board.items.b.transform.x = 160
  reconcileFrames(board, ['b'])
  expect(frameChildren(board, 'f').sort()).toEqual(['a', 'b'])
})

test('deleting a frame cleans stories, edges and groups; removing its frame alone keeps content', () => {
  const board = populated()
  board.frames.other = { id: 'other', bounds: { x: 500, y: 0, width: 200, height: 200 } }
  board.frameEdges.e = { id: 'e', from: 'f', to: 'other' }
  board.stories.s = { id: 's', title: 'story', steps: [{ id: 'first', frameId: 'f' }, { id: 'next', frameId: 'other', visibleItems: ['a', 'c'], revealItems: ['b'] }] }
  const keep = structuredClone(board)
  removeObjects(keep, ['f'], false)
  expect(Object.keys(keep.items)).toEqual(['a', 'b', 'c'])
  expect(keep.items.a.frameId).toBeUndefined()
  removeObjects(board, ['f'])
  expect(Object.keys(board.items)).toEqual(['c'])
  expect(board.frameEdges).toEqual({})
  expect(board.stories.s.steps).toEqual([{ id: 'next', frameId: 'other', visibleItems: ['c'], revealItems: [] }])
})

test('copying grouped frames remaps every frame, group, item and connecting edge independently', () => {
  const board = populated()
  board.frames.other = { id: 'other', bounds: { x: 500, y: 0, width: 200, height: 200 } }
  reconcileFrames(board)
  groupObjects(board, ['f', 'other'])
  board.frameEdges.e = { id: 'e', from: 'f', to: 'other' }
  const clip = createClip(board, expandGroups(board, ['f']))
  const target = blank('target')
  const pasted = insertClip(target, clip, { x: 1000, y: 2000 })
  expect(pasted).toHaveLength(2)
  expect(Object.keys(target.items)).toHaveLength(3)
  expect(Object.keys(target.frameEdges)).toHaveLength(1)
  expect(new Set(Object.values(target.frames).flatMap(frame => frame.groupIds!)).size).toBe(1)
  expect(Object.values(target.frames)[0].groupIds).not.toEqual(board.frames.f.groupIds)
  expect(Object.values(target.items).every(item => !!target.frames[item.frameId!])).toBe(true)
  expect(Object.values(target.frameEdges).every(edge => !!target.frames[edge.from] && !!target.frames[edge.to])).toBe(true)
  expect(Object.values(target.frames)[0].bounds.x).toBe(1000)
  expect(clip.items[0].id).toBe('a')
})

test('partial member duplication does not accidentally join its source group/frame', () => {
  const board = populated()
  groupObjects(board, ['a', 'b'])
  const pasted = insertClip(board, createClip(board, ['a']), { x: 800, y: 800 })
  expect(board.items[pasted[0]].groupIds).toBeUndefined()
  expect(board.items[pasted[0]].frameId).toBeUndefined()
  expect(expandGroups(board, ['a'])).toEqual(['a', 'b'])
})

test('wrapping in a frame and grouping can be undone and redone without losing membership', () => {
  const board = populated()
  boardState().setBoard(board)
  boardState().change(board => { wrapInFrame(board, ['a', 'b']) })
  const frame = boardState().board.items.a.frameId
  expect(frame).not.toBe('f')
  boardState().undo()
  expect(boardState().board.items.a.frameId).toBe('f')
  boardState().redo()
  expect(boardState().board.items.a.frameId).toBe(frame)
})

test('clipboard validation rejects malformed content without breaking ordinary text paste', () => {
  const clip = createClip(populated(), ['a'])
  expect(parseClip(JSON.stringify(clip))).toEqual(clip)
  expect(parseClip('# normal Markdown')).toBeNull()
  expect(parseClip(JSON.stringify({ ...clip, items: [{ ...clip.items[0], transform: { x: null, y: 0, width: 10, height: 10 } }] }))).toBeNull()
  expect(parseClip(JSON.stringify({ ...clip, items: [{ ...clip.items[0], text: 12 }] }))).toBeNull()
  expect(parseClip(JSON.stringify({ ...clip, assets: { test: 'https://example.com/image.png' } }))).toBeNull()
})

test('clipboard embeds images and restores them under new asset IDs for transfer between boards', async () => {
  const source = populated()
  source.items.image = { id: 'image', type: 'image', assetId: 'clipboard-image', transform: { x: 10, y: 10, width: 80, height: 60 } }
  await saveAsset('clipboard-image', new Blob(['fake image bytes'], { type: 'image/png' }))
  let text = ''
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { text = value } } })
  await writeClip(createClip(source, ['image']))
  const clip = parseClip(text)!
  expect(clip.assets?.['clipboard-image']).toMatch(/^data:image\/png;base64,/)
  const restored = await restoreClipAssets(clip)
  const image = restored.items[0]
  expect(image.type).toBe('image')
  if (image.type !== 'image') throw Error('missing image')
  expect(image.assetId).not.toBe('clipboard-image')
  expect(await (await loadAsset(image.assetId))!.text()).toBe('fake image bytes')
  expect((source.items.a as TextItem).text).toBe('a')
})

test('groups and an explicit Frame detach survive a save/load without reattaching the contents', async () => {
  const board = populated()
  groupObjects(board, ['a', 'b'])
  delete board.items.a.frameId; delete board.items.b.frameId
  await saveBoard(board)
  boardState().setBoard((await loadBoard(board.id))!)
  expect(boardState().board.items.a.frameId).toBeUndefined()
  expect(expandGroups(boardState().board, ['a'])).toEqual(['a', 'b'])
})

test('undoing a duplicate clears stale object selection before another grouping operation', () => {
  boardState().setBoard(populated())
  let pasted: string[] = []
  boardState().change(board => { pasted = insertClip(board, createClip(board, ['a', 'b'])) })
  boardState().setMultiSelection(pasted)
  boardState().undo()
  expect(boardState().multiSelection).toEqual([])
  expect(canGroup(boardState().board, pasted)).toBe(false)
})
