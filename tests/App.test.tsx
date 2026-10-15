import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from '../src/App'
import { clearStorage, listBoards, loadBoard, saveBoard } from '../src/storage'
import { boardState } from '../src/store'
import { blank } from './fixtures'
import type { Board } from '../src/model'
import { reconcileFrames } from '../src/boardOperations'
import originalDemo from './fourier-demo.json'

let root: Root
let host: HTMLDivElement
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
const button = (name: string) => Array.from(host.querySelectorAll('button')).find(button => (button.getAttribute('aria-label') || button.textContent) === name)!
const click = async (target: HTMLElement) => { expect(target).toBeDefined(); await act(async () => target.click()); await settle() }

beforeEach(async () => {
  await clearStorage()
  localStorage.clear()
  window.history.replaceState(null, '', '/?board=first')
  boardState().setBoard(blank('initial'))
  await saveBoard(blank('first'))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

async function mount() {
  await act(async () => root.render(<StrictMode><App /></StrictMode>))
  await settle()
  expect(button('first')).toBeDefined()
}

test('deleting the active board cancels pending saves, activates the remaining board, and survives reload', async () => {
  await saveBoard(blank('second'))
  await mount()
  await act(async () => {
    boardState().change(board => { board.title = 'edited first' })
    boardState().pushView()
  })
  await click(button('edited first'))
  await click(button('Delete board: first'))
  expect(await loadBoard('first')).toBeUndefined()
  expect(boardState().board.id).toBe('second')
  expect(boardState().viewPast).toEqual([])
  expect(new URL(location.href).searchParams.get('board')).toBe('second')
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)) })
  expect(await loadBoard('first')).toBeUndefined()
  await act(async () => root.unmount())
  root = createRoot(host)
  await act(async () => root.render(<StrictMode><App /></StrictMode>))
  await settle()
  expect(boardState().board.id).toBe('second')
})

test('deleting the last board creates and persists a blank replacement', async () => {
  await mount()
  await click(button('first'))
  await click(button('Delete board: first'))
  const replacement = boardState().board
  expect(replacement.id).not.toBe('first')
  expect(replacement.title).toBe('Untitled board')
  expect((await listBoards()).map(board => board.id)).toEqual([replacement.id])
  expect(await loadBoard(replacement.id)).toEqual(replacement)
})

test('cancel leaves boards intact; deleting an inactive board preserves current edits', async () => {
  await saveBoard(blank('second'))
  await mount()
  await act(async () => boardState().change(board => { board.title = 'unsaved edit' }))
  await click(button('unsaved edit'))
  vi.mocked(window.confirm).mockReturnValueOnce(false)
  await click(button('Delete board: second'))
  expect(await loadBoard('second')).toBeDefined()
  await click(button('Delete board: second'))
  expect(await loadBoard('second')).toBeUndefined()
  expect(boardState().board.id).toBe('first')
  expect((await loadBoard('first'))?.title).toBe('unsaved edit')
  expect(window.alert).not.toHaveBeenCalled()
})


test('a new browser opens the editable guide without depending on a downloaded demo image', async () => {
  await clearStorage()
  window.history.replaceState(null, '', '/')
  const fetch = vi.spyOn(window, 'fetch').mockRejectedValue(new Error('offline'))
  await act(async () => root.render(<StrictMode><App /></StrictMode>))
  await settle()
  const guide = boardState().board
  expect(guide.id).toBe('main')
  expect(guide.title).toBe('Trace · 白板使用指南')
  expect(Object.values(guide.items).filter(item => item.type === 'text').every(item => item.markdown)).toBe(true)
  expect(host.querySelector('h1')?.textContent).toBe('欢迎来到 Trace')
  expect(button('入门指南')).toBeUndefined()
  expect(Object.keys(guide.frames)).toHaveLength(4)
  expect(guide.stories['guide-tour'].steps).toHaveLength(4)
  expect(new Set(Object.values(guide.items).map(item => item.type))).toEqual(new Set(['text', 'code', 'formula', 'image', 'drawing']))
  expect(boardState().viewport.zoom).toBeGreaterThan(.72)
  expect(await loadBoard(guide.id)).toEqual(guide)
  expect(fetch).not.toHaveBeenCalled()
})

test('returning users retain their boards without an extra guide button or board', async () => {
  await mount()
  expect(button('入门指南')).toBeUndefined()
  expect(boardState().board.id).toBe('first')
  expect((await listBoards()).map(board => board.id)).toEqual(['first'])
})

test('the unchanged Fourier example is replaced in place by the Markdown guide', async () => {
  const original = structuredClone(originalDemo) as Board
  // Object key order is not a user edit.
  original.items = Object.fromEntries(Object.entries(original.items).reverse())
  await saveBoard(original)
  window.history.replaceState(null, '', '/?board=main')
  await act(async () => root.render(<StrictMode><App /></StrictMode>))
  await settle()
  expect(boardState().board.id).toBe('main')
  expect(boardState().board.title).toBe('Trace · 白板使用指南')
  expect((await loadBoard('main'))?.items['guide-welcome']).toBeDefined()
  expect((await listBoards()).map(board => board.id).sort()).toEqual(['first', 'main'])
})

test('editing the old example keeps its contents intact even when its title is unchanged', async () => {
  const edited = structuredClone(originalDemo) as Board
  edited.items.f1.transform.x += 20
  await saveBoard(edited)
  window.history.replaceState(null, '', '/?board=main')
  await act(async () => root.render(<StrictMode><App /></StrictMode>))
  await settle()
  reconcileFrames(edited)
  edited.frameMembership = true
  expect(boardState().board).toEqual(edited)
  expect(await loadBoard('main')).toEqual(edited)
})

const object = (id: string) => host.querySelector<HTMLElement>(`[data-item-id="${id}"], .frame-title[data-frame-id="${id}"]`)!
const pointer = async (target: EventTarget, type: string, options: MouseEventInit = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100, ...options })
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } })
  await act(async () => target.dispatchEvent(event))
}
const context = async (target: HTMLElement, x = 300, y = 200) => {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y })
  await act(async () => target.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
}
const menuItem = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.querySelector('span:not(.menu-icon-space)')?.textContent === label)!
async function seedObjects() {
  await act(async () => boardState().change(board => {
    for (const [id, x] of [['a', 20], ['b', 160], ['c', 520]] as const) board.items[id] = { id, type: 'text', text: id, fontSize: 20, transform: { x, y: 30, width: 100, height: 60 } }
    board.frames.f = { id: 'f', title: 'frame', bounds: { x: 0, y: 0, width: 320, height: 200 } }
    reconcileFrames(board)
  }))
  await act(async () => boardState().setViewport({ x: 0, y: 0, zoom: 1 }))
}
const key = async (key: string, options: KeyboardEventInit = {}) => {
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })))
}

test('canvas right-click opens a custom menu without starting a move or pan', async () => {
  await mount(); await seedObjects()
  const before = structuredClone(boardState().board), viewport = { ...boardState().viewport }
  await pointer(object('a'), 'pointerdown', { button: 2 })
  await context(object('a'))
  await pointer(window, 'pointermove', { clientX: 250, clientY: 260 })
  expect(boardState().board).toEqual(before)
  expect(boardState().viewport).toEqual(viewport)
  expect(menuItem('复制').disabled).toBe(false)
  expect(menuItem('编组').disabled).toBe(true)
  await act(async () => menuItem('复制').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(host.querySelector('[role="menu"]')).toBeNull()
})

test('Shift selection, menu grouping, group dragging, keyboard ungroup and undo stay coherent', async () => {
  await mount(); await seedObjects()
  await pointer(object('a'), 'pointerdown'); await pointer(window, 'pointerup')
  await pointer(object('b'), 'pointerdown', { shiftKey: true }); await pointer(window, 'pointerup')
  expect(boardState().multiSelection).toEqual(['a', 'b'])
  await context(object('a')); await click(menuItem('编组'))
  expect(boardState().board.items.a.groupIds).toEqual(boardState().board.items.b.groupIds)
  await pointer(host.querySelector('.canvas-surface')!, 'pointerdown'); await pointer(window, 'pointerup')
  await pointer(object('a'), 'pointerdown')
  expect(boardState().multiSelection).toEqual(['a', 'b'])
  await pointer(window, 'pointermove', { clientX: 200, clientY: 200, altKey: true }); await pointer(window, 'pointerup')
  expect(boardState().board.items.a.transform.x).toBe(120)
  expect(boardState().board.items.b.transform.x).toBe(260)
  expect(boardState().board.items.a.frameId).toBeUndefined()
  await key('G', { ctrlKey: true, shiftKey: true })
  expect(boardState().board.items.a.groupIds).toBeUndefined()
  await key('z', { ctrlKey: true })
  expect(boardState().board.items.a.groupIds).toBeDefined()
})

test('a frame drag carries contents once; frame resize does not scale those contents', async () => {
  await mount(); await seedObjects()
  await pointer(object('f'), 'pointerdown')
  await pointer(window, 'pointermove', { clientX: 200, clientY: 200, altKey: true }); await pointer(window, 'pointerup')
  expect(boardState().board.frames.f.bounds.x).toBe(100)
  expect(boardState().board.items.a.transform.x).toBe(120)
  expect(boardState().board.items.b.transform.x).toBe(260)
  const item = structuredClone(boardState().board.items.a)
  await pointer(host.querySelector('.resize-handle')!, 'pointerdown')
  await pointer(window, 'pointermove', { clientX: 300, clientY: 300, altKey: true }); await pointer(window, 'pointerup')
  expect(boardState().board.items.a).toEqual(item)
  expect(boardState().board.frames.f.bounds.width).toBe(520)
})

test('menu removes a frame alone while normal delete removes frame contents and undo recovers them', async () => {
  await mount(); await seedObjects()
  await context(object('f')); await click(menuItem('移除 Frame，保留内容'))
  expect(boardState().board.frames.f).toBeUndefined()
  expect(boardState().board.items.a).toBeDefined()
  expect(boardState().board.items.a.frameId).toBeUndefined()
  await key('z', { ctrlKey: true })
  await context(object('f')); await click(menuItem('删除 Frame 及内容'))
  expect(boardState().board.items.a).toBeUndefined()
  expect(boardState().board.items.b).toBeUndefined()
  expect(boardState().board.items.c).toBeDefined()
  await key('z', { ctrlKey: true })
  expect(boardState().board.items.a.frameId).toBe('f')
})

test('cut and menu paste work with clipboard denial and preserve group relationships at the clicked position', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')), read: vi.fn().mockRejectedValue(new Error('denied')) } })
  await mount(); await seedObjects()
  await act(async () => boardState().setMultiSelection(['a', 'b']))
  await key('g', { ctrlKey: true })
  await context(object('a')); await click(menuItem('剪切'))
  expect(boardState().board.items.a).toBeUndefined()
  expect(boardState().board.items.b).toBeUndefined()
  await context(host.querySelector('.canvas-surface')!, 900, 450)
  await click(menuItem('粘贴'))
  const pasted = Object.values(boardState().board.items).filter(item => item.id !== 'c')
  expect(pasted).toHaveLength(2)
  expect(pasted[0].groupIds).toEqual(pasted[1].groupIds)
  expect(pasted[0].transform.x).toBe(900)
  expect(pasted[0].transform.y).toBe(450)
  expect(boardState().multiSelection).toHaveLength(2)
})

test('native text paste creates Markdown while clipboard shortcuts leave form inputs alone', async () => {
  await mount()
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => '# Hello\n\n- pasted note', files: [] } })
  await act(async () => window.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true)
  const item = Object.values(boardState().board.items)[0]
  expect(item.type === 'text' && item.markdown).toBe(true)
  const input = document.createElement('input'); host.append(input)
  const cut = new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true, cancelable: true })
  await act(async () => input.dispatchEvent(cut))
  expect(cut.defaultPrevented).toBe(false)
  expect(Object.values(boardState().board.items)).toHaveLength(1)
})

function fire(target: Element | Window, type: string, init: { pointerId: number; pointerType: string; x: number; y: number }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x, clientY: init.y, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
  Object.assign(event, { pointerId: init.pointerId, pointerType: init.pointerType, pressure: .5 })
  return act(async () => { target.dispatchEvent(event) })
}
const drawings = () => Object.values(boardState().board.items).filter(item => item.type === 'drawing')

test('pen draws, finger with the pen tool pans instead, and a finger cannot interrupt a pen stroke', async () => {
  await mount()
  boardState().setTool('pen')
  const surface = host.querySelector('.canvas-surface')!
  const before = boardState().viewport

  await fire(surface, 'pointerdown', { pointerId: 1, pointerType: 'touch', x: 200, y: 200 })
  await fire(window, 'pointermove', { pointerId: 1, pointerType: 'touch', x: 260, y: 240 })
  await fire(window, 'pointerup', { pointerId: 1, pointerType: 'touch', x: 260, y: 240 })
  expect(drawings()).toHaveLength(0)
  expect(boardState().viewport.x).toBe(before.x + 60)

  await fire(surface, 'pointerdown', { pointerId: 2, pointerType: 'pen', x: 300, y: 300 })
  await fire(surface, 'pointerdown', { pointerId: 3, pointerType: 'touch', x: 500, y: 500 })
  await fire(window, 'pointermove', { pointerId: 3, pointerType: 'touch', x: 520, y: 520 })
  await fire(window, 'pointermove', { pointerId: 2, pointerType: 'pen', x: 330, y: 320 })
  await fire(window, 'pointerup', { pointerId: 3, pointerType: 'touch', x: 520, y: 520 })
  await fire(window, 'pointermove', { pointerId: 2, pointerType: 'pen', x: 360, y: 340 })
  await fire(window, 'pointerup', { pointerId: 2, pointerType: 'pen', x: 360, y: 340 })
  expect(drawings()).toHaveLength(1)
  expect((drawings()[0] as { points: unknown[] }).points).toHaveLength(3)
})
