import { create } from 'zustand'
import { produce, setAutoFreeze } from 'immer'
import type { Board, CanvasItem, Selection, Tool, Viewport } from './model'
import { PEN_PRESETS, type PenSettings } from './ink'
import { boundsFor, expandGroups, reconcileFrames, selectedIds } from './boardOperations'

type State = {
  board: Board
  viewport: Viewport
  tool: Tool
  pen: PenSettings
  tablet: boolean
  setTablet: (on: boolean) => void
  setPen: (pen: Partial<PenSettings>) => void
  selection: Selection
  multiSelection: string[]
  editing: string | null
  past: Board[]
  future: Board[]
  viewPast: Viewport[]
  viewFuture: Viewport[]
  setBoard: (board: Board) => void
  change: (update: (board: Board) => void) => void
  beginGesture: () => void
  updateGesture: (update: (board: Board) => void) => void
  replaceItem: (item: CanvasItem) => void
  undo: () => void
  redo: () => void
  setTool: (tool: Tool) => void
  setSelection: (selection: Selection) => void
  setMultiSelection: (ids: string[]) => void
  discardNewItem: (id: string) => void
  setEditing: (id: string | null) => void
  setViewport: (viewport: Viewport) => void
  pushView: () => void
  viewBack: () => void
  viewForward: () => void
}

const emptyBoard: Board = { id: 'main', version: 2, title: 'Untitled board', items: {}, frames: {}, frameEdges: {}, stories: {} }
setAutoFreeze(false)
const clone = (board: Board) => structuredClone(board)
// Structural sharing: untouched items keep their identity, which incremental saves and memoised rendering rely on.
const edit = (board: Board, update: (board: Board) => void) => produce(board, update)
const restoredSelection = (board: Board, state: State): Pick<State, 'selection' | 'multiSelection'> => {
  if (state.selection?.kind === 'edge') return { selection: board.frameEdges[state.selection.id] ? state.selection : null, multiSelection: [] }
  const ids = expandGroups(board, selectedIds(state.selection, state.multiSelection).filter(id => !!boundsFor(board, id)))
  return ids.length === 1 ? { selection: { kind: board.frames[ids[0]] ? 'frame' : 'item', id: ids[0] }, multiSelection: [] } : { selection: null, multiSelection: ids }
}

const PEN_KEY = 'trace.pen'
const TABLET_KEY = 'trace.tablet'
const loadPen = (): PenSettings => {
  try { const saved = JSON.parse(localStorage.getItem(PEN_KEY) || 'null'); if (saved && PEN_PRESETS[saved.mode as 'ink'] && Number.isFinite(saved.width)) return { ...PEN_PRESETS[saved.mode as 'ink'], ...saved } } catch { /* storage unavailable */ }
  return PEN_PRESETS.technical
}

export const useBoard = create<State>((set) => ({
  board: emptyBoard,
  viewport: { x: 100, y: 100, zoom: 1 },
  tablet: (() => { try { return localStorage.getItem(TABLET_KEY) === '1' } catch { return false } })(),
  setTablet: on => {
    try { localStorage.setItem(TABLET_KEY, on ? '1' : '0') } catch { /* storage unavailable */ }
    set(state => on ? { tablet: true, tool: 'pen', editing: null, pen: state.pen } : { tablet: false })
  },
  pen: loadPen(),
  setPen: patch => set(state => {
    // Switching mode loads that mode's preset; individual fields then adjust it.
    const pen = patch.mode && patch.mode !== state.pen.mode ? { ...PEN_PRESETS[patch.mode], ...patch } : { ...state.pen, ...patch }
    try { localStorage.setItem(PEN_KEY, JSON.stringify(pen)) } catch { /* storage unavailable */ }
    return { pen }
  }),
  tool: 'select', selection: null, multiSelection: [], editing: null,
  past: [], future: [], viewPast: [], viewFuture: [],
  setBoard: input => {
    const board = clone(input)
    if (!board.frameMembership) { reconcileFrames(board); board.frameMembership = true }
    set({ board, past: [], future: [], viewPast: [], viewFuture: [], selection: null, multiSelection: [], editing: null })
  },
  change: update => set(state => {
    const board = edit(state.board, update)
    return { board, past: [...state.past.slice(-79), state.board], future: [] }
  }),
  beginGesture: () => set(state => ({ past: [...state.past.slice(-79), state.board], future: [] })),
  updateGesture: update => set(state => ({ board: edit(state.board, update) })),
  // Shares every other item with the previous board instead of cloning it; undo snapshots stay untouched.
  replaceItem: item => set(state => state.board.items[item.id] ? { board: { ...state.board, items: { ...state.board.items, [item.id]: item } } } : state),
  discardNewItem: id => set(state => {
    const board = edit(state.board, b => { delete b.items[id] })
    const last = state.past.at(-1)
    return { board, selection: null, multiSelection: [], editing: null, past: last && !last.items[id] ? state.past.slice(0, -1) : state.past }
  }),
  undo: () => set(state => {
    if (!state.past.length) return state
    const board = state.past.at(-1)!
    return { board, ...restoredSelection(board, state), past: state.past.slice(0, -1), future: [state.board, ...state.future], editing: null }
  }),
  redo: () => set(state => {
    if (!state.future.length) return state
    const board = state.future[0]
    return { board, ...restoredSelection(board, state), past: [...state.past, state.board], future: state.future.slice(1), editing: null }
  }),
  setTool: tool => set({ tool, editing: null }),
  setSelection: selection => set({ selection, multiSelection: [] }),
  setMultiSelection: ids => set({ multiSelection: ids, selection: null }),
  setEditing: editing => set({ editing }),
  setViewport: viewport => set({ viewport }),
  pushView: () => set(state => ({ viewPast: [...state.viewPast.slice(-39), state.viewport], viewFuture: [] })),
  viewBack: () => set(state => !state.viewPast.length ? state : ({ viewport: state.viewPast.at(-1)!, viewPast: state.viewPast.slice(0, -1), viewFuture: [state.viewport, ...state.viewFuture] })),
  viewForward: () => set(state => !state.viewFuture.length ? state : ({ viewport: state.viewFuture[0], viewPast: [...state.viewPast, state.viewport], viewFuture: state.viewFuture.slice(1) })),
}))

export const boardState = () => useBoard.getState()
