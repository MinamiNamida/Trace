import { create } from 'zustand'
import type { Board, Selection, Tool, Viewport } from './model'

type State = {
  board: Board
  viewport: Viewport
  tool: Tool
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
const clone = (board: Board) => structuredClone(board)

export const useBoard = create<State>((set) => ({
  board: emptyBoard,
  viewport: { x: 100, y: 100, zoom: 1 },
  tool: 'select', selection: null, multiSelection: [], editing: null,
  past: [], future: [], viewPast: [], viewFuture: [],
  setBoard: board => set({ board, past: [], future: [], selection: null, multiSelection: [], editing: null }),
  change: update => set(state => {
    const board = clone(state.board); update(board)
    return { board, past: [...state.past.slice(-79), state.board], future: [] }
  }),
  beginGesture: () => set(state => ({ past: [...state.past.slice(-79), state.board], future: [] })),
  updateGesture: update => set(state => { const board = clone(state.board); update(board); return { board } }),
  discardNewItem: id => set(state => {
    const board = clone(state.board)
    delete board.items[id]
    const last = state.past.at(-1)
    return { board, selection: null, multiSelection: [], editing: null, past: last && !last.items[id] ? state.past.slice(0, -1) : state.past }
  }),
  undo: () => set(state => {
    if (!state.past.length) return state
    return { board: state.past.at(-1)!, past: state.past.slice(0, -1), future: [state.board, ...state.future], editing: null }
  }),
  redo: () => set(state => {
    if (!state.future.length) return state
    return { board: state.future[0], past: [...state.past, state.board], future: state.future.slice(1), editing: null }
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
