import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, CircleHelp, Code2, Eraser, Focus, Frame, Hand, ImagePlus, Maximize2, MousePointer2, PenLine, Redo2, Sigma, Trash2, Type, Undo2, Waypoints } from 'lucide-react'
import { BoardRenderer } from './BoardRenderer'
import { snapMove, snapResize } from './alignment'
import type { AlignmentGuide } from './alignment'
import { createDemoBoard } from './demo'
import { StoryPanel } from './StoryPanel'
import { InlineRename } from './InlineRename'
import { boardState, useBoard } from './store'
import { clampZoom, fitBounds, screenToWorld, uid, unionBounds, zoomAt } from './model'
import type { Board, CanvasItem, Id, Selection, Tool, Transform, Viewport } from './model'
import { listBoards, loadBoard, saveAsset, saveBoard } from './storage'

type Gesture =
  | { kind: 'pan'; x: number; y: number; viewport: Viewport; pointerId: number; moved: boolean }
  | { kind: 'marquee'; x: number; y: number; currentX: number; currentY: number }
  | { kind: 'createEdit'; id: Id }
  | { kind: 'moveMulti'; x: number; y: number; originals: Record<Id, Transform>; started: boolean }
  | { kind: 'move' | 'resize'; target: Exclude<Selection, null>; x: number; y: number; original: Transform; originalPoints?: { x: number; y: number; pressure?: number }[]; started: boolean }
  | { kind: 'draw'; id: Id; points: { x: number; y: number; pressure: number }[] }
  | { kind: 'frame'; id: Id; x: number; y: number }
  | { kind: 'connect'; from: Id }

const tools: { id: Tool; label: string; shortcut: string; icon: typeof MousePointer2 }[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 },
  { id: 'hand', label: 'Pan', shortcut: 'H', icon: Hand },
  { id: 'text', label: 'Text', shortcut: 'T', icon: Type },
  { id: 'code', label: 'Code block', shortcut: 'C', icon: Code2 },
  { id: 'formula', label: 'Formula', shortcut: 'F', icon: Sigma },
  { id: 'image', label: 'Image', shortcut: 'I', icon: ImagePlus },
  { id: 'pen', label: 'Pen', shortcut: 'P', icon: PenLine },
  { id: 'eraser', label: 'Eraser', shortcut: 'E', icon: Eraser },
  { id: 'frame', label: 'Frame', shortcut: 'R', icon: Frame },
  { id: 'edge', label: 'Frame edge', shortcut: 'L', icon: Waypoints },
]

const viewportEqual = (a: Viewport, b: Viewport) => Math.abs(a.x-b.x) < 1 && Math.abs(a.y-b.y) < 1 && Math.abs(a.zoom-b.zoom) < .001
const alignmentReferences = (board: Board, excluded: Set<Id>) => [
  ...Object.values(board.items).filter(item => !excluded.has(item.id)).map(item => item.transform),
  ...Object.values(board.frames).filter(frame => !excluded.has(frame.id)).map(frame => frame.bounds),
]
const Presentation = lazy(() => import('./Presentation').then(module => ({ default: module.Presentation })))

export default function App() {
  const board = useBoard(s => s.board)
  const viewport = useBoard(s => s.viewport)
  const tool = useBoard(s => s.tool)
  const selection = useBoard(s => s.selection)
  const multiSelection = useBoard(s => s.multiSelection)
  const editing = useBoard(s => s.editing)
  const past = useBoard(s => s.past)
  const future = useBoard(s => s.future)
  const viewPast = useBoard(s => s.viewPast)
  const viewFuture = useBoard(s => s.viewFuture)
  const root = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const gesturePointer = useRef<number | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ viewport: Viewport; world: { x: number; y: number }; distance: number; ids: [number, number] } | null>(null)
  const lastTouchTap = useRef<{ id: Id; time: number } | null>(null)
  const space = useRef(false)
  const newItemIds = useRef(new Set<Id>())
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [snapGuides, setSnapGuides] = useState<AlignmentGuide[]>([])
  const [panning, setPanning] = useState(false)
  const [ready, setReady] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [connector, setConnector] = useState<{ from: Id; x: number; y: number } | null>(null)
  const [imagePosition, setImagePosition] = useState<{ x: number; y: number } | null>(null)
  const [saveState, setSaveState] = useState('Saved locally')
  const [boardMenu, setBoardMenu] = useState(false)
  const [renamingBoard, setRenamingBoard] = useState(false)
  const [boardList, setBoardList] = useState<{ id: string; title: string }[]>([])
  const [showStory, setShowStory] = useState(false)
  const [activeStoryId, setActiveStoryId] = useState<Id | null>(null)
  const [presentingStoryId, setPresentingStoryId] = useState<Id | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const query = new URLSearchParams(window.location.search)
      const activeId = query.get('board') || localStorage.getItem('spatial-learning-board.active') || 'main'
      const stored = await loadBoard(activeId)
      const initial = stored || await loadBoard('main') || await createDemoBoard()
      if (!active) return
      boardState().setBoard(initial)
      localStorage.setItem('spatial-learning-board.active', initial.id)
      setBoardList([...(await listBoards()).filter(entry => entry.id !== initial.id), { id: initial.id, title: initial.title }])
      const bounds = unionBounds([...Object.values(initial.items).map(i => i.transform), ...Object.values(initial.frames).map(f => ({ ...f.bounds, y: f.bounds.y - 48, height: f.bounds.height + 48 }))])
      if (bounds) boardState().setViewport(fitBounds(bounds, window.innerWidth, window.innerHeight, 76))
      const requestedStory = query.get('story')
      if (requestedStory && initial.stories[requestedStory]?.steps.length) setPresentingStoryId(requestedStory)
      setReady(true)
    })()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!ready) return
    setSaveState('Saving…')
    const timer = window.setTimeout(() => saveBoard(board).then(() => setSaveState('Saved locally')).catch(() => setSaveState('Save failed')), 450)
    return () => clearTimeout(timer)
  }, [board, ready])

  const screenPoint = (event: { clientX: number; clientY: number }) => {
    const rect = root.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const worldPoint = (event: { clientX: number; clientY: number }) => {
    const p = screenPoint(event)
    return screenToWorld(p.x, p.y, boardState().viewport)
  }

  const startPan = (event: React.PointerEvent) => {
    const state = boardState()
    const p = screenPoint(event)
    gesture.current = { kind: 'pan', x: p.x, y: p.y, viewport: state.viewport, pointerId: event.pointerId, moved: false }
    setPanning(true)
  }

  const onSurfacePointerDownCapture = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch' && !(event.target as Element).closest('.canvas-item.editing, .frame-title:has(input)')) {
      touches.current.set(event.pointerId, screenPoint(event))
      if (touches.current.size === 2) {
        const [[firstId, a], [secondId, b]] = [...touches.current.entries()]
        const state = boardState()
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        pinch.current = { viewport: state.viewport, world: screenToWorld(middle.x, middle.y, state.viewport), distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), ids: [firstId, secondId] }
        state.pushView()
        gesture.current = null
        gesturePointer.current = null
        setPanning(false)
        setMarquee(null)
        setSnapGuides([])
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (touches.current.size > 2 || pinch.current) { event.stopPropagation(); return }
      gesturePointer.current = event.pointerId
    }
    if (!pinch.current) gesturePointer.current = event.pointerId
    if (event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
    root.current?.setPointerCapture(event.pointerId)
    startPan(event)
  }

  const addImage = async (file: File, at?: { x: number; y: number }) => {
    if (!file.type.startsWith('image/')) return
    const id = uid()
    await saveAsset(id, file)
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.src = url
    await image.decode().catch(() => {})
    const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1.5
    URL.revokeObjectURL(url)
    const width = Math.min(540, Math.max(220, image.naturalWidth || 420))
    const point = at || screenToWorld(window.innerWidth / 2, window.innerHeight / 2, boardState().viewport)
    const item: CanvasItem = { id, type: 'image', assetId: id, alt: file.name, transform: { x: point.x, y: point.y, width, height: width / ratio } }
    boardState().change(board => { board.items[id] = item })
    boardState().setSelection({ kind: 'item', id })
    boardState().setTool('select')
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (boardState().editing) return
      const file = [...(event.clipboardData?.files || [])].find(f => f.type.startsWith('image/'))
      if (file) { event.preventDefault(); void addImage(file) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const removeSelection = () => {
    const selected = boardState().selection
    const multi = boardState().multiSelection
    if (!selected && !multi.length) return
    boardState().change(board => {
      for (const id of multi) delete board.items[id]
      if (selected?.kind === 'item') delete board.items[selected.id]
      if (selected?.kind === 'frame') {
        delete board.frames[selected.id]
        for (const edge of Object.values(board.frameEdges)) if (edge.from === selected.id || edge.to === selected.id) delete board.frameEdges[edge.id]
      }
      if (selected?.kind === 'edge') delete board.frameEdges[selected.id]
    })
    boardState().setSelection(null)
  }

  const finishEditing = () => {
    const state = boardState()
    const id = state.editing
    if (!id) return
    const item = state.board.items[id]
    if (newItemIds.current.has(id)) {
      newItemIds.current.delete(id)
      const empty = item?.type === 'text' ? !item.text.trim() : item?.type === 'code' ? !item.code.trim() : item?.type === 'formula' ? !item.latex.trim() : false
      if (empty) { state.discardNewItem(id); return }
    }
    state.setEditing(null)
  }

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!boardState().editing) return
      const target = event.target as HTMLElement
      if (target.closest('.canvas-item.editing, .frame-title:has(input), .milkdown-latex-inline-edit')) return
      finishEditing()
    }
    window.addEventListener('pointerdown', outside, true)
    return () => window.removeEventListener('pointerdown', outside, true)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = boardState()
      const target = event.target as HTMLElement
      const inField = ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable
      if (event.code === 'Space' && !inField) { event.preventDefault(); space.current = true; return }
      if (inField || state.editing) return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? state.redo() : state.undo(); return }
      if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); state.redo(); return }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        if (state.selection?.kind === 'item') { const original = state.board.items[state.selection.id]; if (original) { const id = uid(); state.change(b => { b.items[id] = { ...structuredClone(original), id, transform: { ...original.transform, x: original.transform.x + 26, y: original.transform.y + 26 } } }); state.setSelection({ kind: 'item', id }) } }
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelection(); return }
      if (event.key === 'Escape') { state.setSelection(null); state.setTool('select'); return }
      if (!mod && !event.altKey) {
        const map: Record<string, Tool> = { v: 'select', h: 'hand', t: 'text', c: 'code', f: 'formula', i: 'image', p: 'pen', e: 'eraser', r: 'frame', l: 'edge' }
        const next = map[event.key.toLowerCase()]
        if (next) { event.preventDefault(); state.setTool(next); if (next === 'image') fileInput.current?.click() }
      }
    }
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') space.current = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [])

  const onBackgroundDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    if (pinch.current || (event.pointerType === 'touch' && touches.current.size > 1)) return
    if (event.pointerType === 'touch') lastTouchTap.current = null
    gesturePointer.current = event.pointerId
    const state = boardState()
    const p = screenPoint(event)
    const w = worldPoint(event)
    if (space.current || state.tool === 'hand' || (event.pointerType === 'touch' && state.tool === 'select')) { startPan(event); return }
    state.setSelection(null)
    if (state.tool === 'text' || state.tool === 'formula' || state.tool === 'code') {
      const id = uid()
      const item: CanvasItem = state.tool === 'text'
        ? { id, type: 'text', text: '', markdown: true, fontSize: 20, transform: { x: w.x, y: w.y, width: 340, height: 100 } }
        : state.tool === 'code'
          ? { id, type: 'code', code: '', language: 'javascript', transform: { x: w.x, y: w.y, width: 480, height: 260 } }
          : { id, type: 'formula', latex: '', transform: { x: w.x, y: w.y, width: 390, height: 74 } }
      state.change(b => { b.items[id] = item }); newItemIds.current.add(id); state.setSelection({ kind: 'item', id }); state.setTool('select'); gesture.current = { kind: 'createEdit', id }
    } else if (state.tool === 'frame') {
      const id = uid()
      state.change(b => { b.frames[id] = { id, title: '', bounds: { x: w.x, y: w.y, width: 1, height: 1 } } })
      state.setSelection({ kind: 'frame', id }); gesture.current = { kind: 'frame', id, x: w.x, y: w.y }
    } else if (state.tool === 'pen') {
      const id = uid()
      const points = [{ x: w.x, y: w.y, pressure: event.pressure || .5 }]
      state.change(b => { b.items[id] = { id, type: 'drawing', points: [{ x: 0, y: 0, pressure: event.pressure || .5 }], lineWidth: 3, transform: { x: w.x, y: w.y, width: 1, height: 1 } } })
      gesture.current = { kind: 'draw', id, points }
    } else if (state.tool === 'image') { setImagePosition(w); fileInput.current?.click() }
    else if (state.tool === 'select') { gesture.current = { kind: 'marquee', x: p.x, y: p.y, currentX: p.x, currentY: p.y } }
  }

  const onObjectDown = (event: React.PointerEvent, kind: 'item' | 'frame' | 'edge', id: Id) => {
    event.stopPropagation()
    if (event.button !== 0) return
    if (pinch.current || (event.pointerType === 'touch' && touches.current.size > 1)) return
    gesturePointer.current = event.pointerId
    const state = boardState()
    if (space.current || state.tool === 'hand') { startPan(event); return }
    if (state.tool === 'eraser' && kind === 'item' && state.board.items[id]?.type === 'drawing') { state.change(b => { delete b.items[id] }); return }
    if (state.tool === 'edge' && kind === 'frame') { gesture.current = { kind: 'connect', from: id }; setConnector({ from: id, ...worldPoint(event) }); return }
    if (state.editing === id || (state.tool !== 'select' && state.tool !== 'eraser')) return
    if (kind === 'item' && state.multiSelection.includes(id)) {
      const p = screenPoint(event)
      gesture.current = { kind: 'moveMulti', x: p.x, y: p.y, originals: Object.fromEntries(state.multiSelection.map(itemId => [itemId, { ...state.board.items[itemId].transform }])), started: false }
      return
    }
    const selected: Exclude<Selection, null> = { kind, id }
    state.setSelection(selected)
    if (kind === 'edge') return
    const original = kind === 'item' ? state.board.items[id]?.transform : state.board.frames[id]?.bounds
    if (!original) return
    const p = screenPoint(event)
    gesture.current = { kind: 'move', target: selected, x: p.x, y: p.y, original: { ...original }, started: false }
  }

  const onResizeDown = (event: React.PointerEvent, kind: 'item' | 'frame', id: Id) => {
    event.stopPropagation()
    if (pinch.current) return
    gesturePointer.current = event.pointerId
    const state = boardState()
    const original = kind === 'item' ? state.board.items[id]?.transform : state.board.frames[id]?.bounds
    if (!original) return
    const p = screenPoint(event)
    const item = kind === 'item' ? state.board.items[id] : undefined
    gesture.current = { kind: 'resize', target: { kind, id }, x: p.x, y: p.y, original: { ...original }, originalPoints: item?.type === 'drawing' ? structuredClone(item.points) : undefined, started: false }
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && touches.current.has(event.pointerId)) {
        touches.current.set(event.pointerId, screenPoint(event))
        const zoom = pinch.current
        if (zoom) {
          const a = touches.current.get(zoom.ids[0]), b = touches.current.get(zoom.ids[1])
          if (a && b) {
            const factor = Math.hypot(a.x - b.x, a.y - b.y) / zoom.distance
            const nextZoom = clampZoom(zoom.viewport.zoom * factor)
            const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
            boardState().setViewport({ x: middle.x - zoom.world.x * nextZoom, y: middle.y - zoom.world.y * nextZoom, zoom: nextZoom })
          }
          return
        }
      }
      const g = gesture.current
      if (!g) return
      if (event.pointerId !== gesturePointer.current) return
      const state = boardState()
      const p = screenPoint(event)
      const w = worldPoint(event)
      if (g.kind === 'pan') {
        const next = { ...g.viewport, x: g.viewport.x + p.x - g.x, y: g.viewport.y + p.y - g.y }
        if (!g.moved && !viewportEqual(next, g.viewport)) { state.pushView(); g.moved = true }
        state.setViewport(next)
      } else if (g.kind === 'marquee') {
        g.currentX = p.x; g.currentY = p.y
        if (Math.hypot(p.x - g.x, p.y - g.y) > 3) setMarquee({ x: Math.min(g.x, p.x), y: Math.min(g.y, p.y), width: Math.abs(p.x - g.x), height: Math.abs(p.y - g.y) })
      } else if (g.kind === 'moveMulti') {
        const dx = (p.x - g.x) / state.viewport.zoom, dy = (p.y - g.y) / state.viewport.zoom
        if (!g.started && Math.hypot(dx, dy) < 2) return
        if (!g.started) { state.beginGesture(); g.started = true }
        const originalBounds = unionBounds(Object.values(g.originals))!
        const raw = { ...originalBounds, x: originalBounds.x + dx, y: originalBounds.y + dy }
        const snapped = event.altKey ? { bounds: raw, guides: [] } : snapMove(raw, alignmentReferences(state.board, new Set(Object.keys(g.originals))), state.viewport.zoom)
        const moveX = snapped.bounds.x - originalBounds.x, moveY = snapped.bounds.y - originalBounds.y
        setSnapGuides(snapped.guides)
        state.updateGesture(b => { for (const [id, original] of Object.entries(g.originals)) if (b.items[id]) b.items[id].transform = { ...original, x: original.x + moveX, y: original.y + moveY } })
      } else if (g.kind === 'move' || g.kind === 'resize') {
        const dx = (p.x - g.x) / state.viewport.zoom, dy = (p.y - g.y) / state.viewport.zoom
        if (!g.started && Math.hypot(dx, dy) < 2) return
        if (!g.started) { state.beginGesture(); g.started = true }
        const original = g.original
        const item = g.target.kind === 'item' ? state.board.items[g.target.id] : undefined
        let next: Transform
        if (g.kind === 'move') next = { ...original, x: original.x + dx, y: original.y + dy }
        else if (item?.type === 'image') { const ratio = original.width / original.height; const width = Math.max(64, original.width + dx); next = { ...original, width, height: width / ratio } }
        else next = { ...original, width: Math.max(60, original.width + dx), height: Math.max(35, original.height + dy) }
        const references = alignmentReferences(state.board, new Set([g.target.id]))
        const snapped = event.altKey ? { bounds: next, guides: [] } : g.kind === 'move'
          ? snapMove(next, references, state.viewport.zoom)
          : snapResize(next, references, state.viewport.zoom, item?.type === 'image' ? 64 : 60, 35, item?.type === 'image' ? original.width / original.height : undefined)
        next = snapped.bounds
        setSnapGuides(snapped.guides)
        state.updateGesture(b => {
          if (g.target.kind === 'item' && b.items[g.target.id]) {
            const target = b.items[g.target.id]
            target.transform = next
            if (g.kind === 'resize' && target.type === 'drawing' && g.originalPoints) target.points = g.originalPoints.map(point => ({ ...point, x: point.x * next.width / Math.max(1, original.width), y: point.y * next.height / Math.max(1, original.height) }))
          }
          if (g.target.kind === 'frame' && b.frames[g.target.id]) b.frames[g.target.id].bounds = next
        })
      } else if (g.kind === 'frame') {
        state.updateGesture(b => { if (b.frames[g.id]) b.frames[g.id].bounds = { x: Math.min(g.x, w.x), y: Math.min(g.y, w.y), width: Math.max(40, Math.abs(w.x-g.x)), height: Math.max(40, Math.abs(w.y-g.y)) } })
      } else if (g.kind === 'draw') {
        g.points.push({ x: w.x, y: w.y, pressure: event.pressure || .5 })
        const minX = Math.min(...g.points.map(v => v.x)), minY = Math.min(...g.points.map(v => v.y))
        const maxX = Math.max(...g.points.map(v => v.x)), maxY = Math.max(...g.points.map(v => v.y))
        state.updateGesture(b => { const item = b.items[g.id]; if (item?.type === 'drawing') { item.points = g.points.map(v => ({ x: v.x-minX, y: v.y-minY, pressure: v.pressure })); item.transform = { x: minX, y: minY, width: Math.max(1,maxX-minX), height: Math.max(1,maxY-minY) } } })
      } else if (g.kind === 'connect') setConnector({ from: g.from, x: w.x, y: w.y })
    }
    const up = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        touches.current.delete(event.pointerId)
        if (pinch.current) {
          if (pinch.current.ids.includes(event.pointerId)) pinch.current = null
          return
        }
      }
      const g = gesture.current
      if (!g) return
      if (event.pointerId !== gesturePointer.current) return
      const state = boardState()
      if (event.pointerType === 'touch' && g.kind === 'move' && !g.started && (g.target.kind === 'item' || g.target.kind === 'frame')) {
        const previous = lastTouchTap.current
        const now = Date.now()
        if (previous?.id === g.target.id && now - previous.time < 400) {
          const item = state.board.items[g.target.id]
          if (g.target.kind === 'frame' || item?.type === 'text' || item?.type === 'code' || item?.type === 'formula') {
            state.beginGesture(); state.setEditing(g.target.id)
          }
          lastTouchTap.current = null
        } else lastTouchTap.current = { id: g.target.id, time: now }
      }
      if (g.kind === 'createEdit') state.setEditing(g.id)
      if (g.kind === 'marquee') {
        const a = screenToWorld(Math.min(g.x, g.currentX), Math.min(g.y, g.currentY), state.viewport)
        const b = screenToWorld(Math.max(g.x, g.currentX), Math.max(g.y, g.currentY), state.viewport)
        if (Math.hypot(g.currentX-g.x, g.currentY-g.y) > 3) {
          const ids = Object.values(state.board.items).filter(item => item.transform.x < b.x && item.transform.x + item.transform.width > a.x && item.transform.y < b.y && item.transform.y + item.transform.height > a.y).map(item => item.id)
          if (ids.length === 1) state.setSelection({ kind: 'item', id: ids[0] })
          else state.setMultiSelection(ids)
        }
        setMarquee(null)
      }
      if (g.kind === 'frame') { state.setEditing(g.id); state.setTool('select') }
      if (g.kind === 'connect') {
        const p = worldPoint(event)
        const target = Object.values(state.board.frames).find(f => f.id !== g.from && p.x >= f.bounds.x && p.x <= f.bounds.x+f.bounds.width && p.y >= f.bounds.y-40 && p.y <= f.bounds.y+f.bounds.height)
        if (target && !Object.values(state.board.frameEdges).some(e => e.from === g.from && e.to === target.id)) { const id = uid(); state.change(b => { b.frameEdges[id] = { id, from: g.from, to: target.id } }) }
        setConnector(null)
      }
      if (g.kind === 'pan') setPanning(false)
      setSnapGuides([])
      gesture.current = null
      gesturePointer.current = null
    }
    const cancel = () => { gesture.current = null; gesturePointer.current = null; touches.current.clear(); pinch.current = null; setPanning(false); setSnapGuides([]); setMarquee(null); setConnector(null) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel) }
  }, [])

  const wheelActive = useRef(false)
  const wheelTimer = useRef(0)
  const pinchStart = useRef<Viewport | null>(null)
  useEffect(() => {
    const surface = root.current
    if (!surface) return
    const wheel = (event: WheelEvent) => {
      const target = event.target as Element
      if (target.closest('.presentation-shell')) return
      const overCanvas = surface.contains(target)
      if (!overCanvas && !(target.closest('.app') && (event.ctrlKey || event.metaKey))) return
      event.preventDefault()
      const state = boardState()
      const p = screenPoint(event)
      const mouseWheel = event.deltaMode !== 0 || (Math.abs(event.deltaY) >= 45 && Math.abs(event.deltaX) < 1)
      const next = event.ctrlKey || event.metaKey || mouseWheel
        ? zoomAt(state.viewport, p.x, p.y, state.viewport.zoom * Math.exp(-event.deltaY * (event.deltaMode ? .04 : event.ctrlKey || event.metaKey ? .003 : .009)))
        : { ...state.viewport, x: state.viewport.x - event.deltaX, y: state.viewport.y - event.deltaY }
      if (!viewportEqual(next, state.viewport)) {
        if (!wheelActive.current) { state.pushView(); wheelActive.current = true }
        clearTimeout(wheelTimer.current)
        wheelTimer.current = window.setTimeout(() => { wheelActive.current = false }, 350)
        state.setViewport(next)
      }
    }
    type WebkitGesture = Event & { scale?: number; clientX?: number; clientY?: number }
    const gestureStart = (raw: Event) => {
      const event = raw as WebkitGesture
      if (!(event.target as Element)?.closest('.app') || (event.target as Element).closest('.presentation-shell')) return
      if (touches.current.size) { event.preventDefault(); return }
      event.preventDefault()
      pinchStart.current = boardState().viewport
      boardState().pushView()
    }
    const gestureChange = (raw: Event) => {
      const event = raw as WebkitGesture
      if (!pinchStart.current || pinch.current) return
      event.preventDefault()
      const rect = surface.getBoundingClientRect()
      const x = (event.clientX ?? rect.left + rect.width / 2) - rect.left
      const y = (event.clientY ?? rect.top + rect.height / 2) - rect.top
      boardState().setViewport(zoomAt(pinchStart.current, x, y, pinchStart.current.zoom * (event.scale ?? 1)))
    }
    const gestureEnd = (event: Event) => { if (pinchStart.current) event.preventDefault(); pinchStart.current = null }
    document.addEventListener('wheel', wheel, { passive: false, capture: true })
    document.addEventListener('gesturestart', gestureStart, { passive: false, capture: true })
    document.addEventListener('gesturechange', gestureChange, { passive: false, capture: true })
    document.addEventListener('gestureend', gestureEnd, { passive: false, capture: true })
    return () => {
      document.removeEventListener('wheel', wheel, true)
      document.removeEventListener('gesturestart', gestureStart, true)
      document.removeEventListener('gesturechange', gestureChange, true)
      document.removeEventListener('gestureend', gestureEnd, true)
    }
  }, [ready])

  const focus = (bounds: Transform | null) => {
    if (!bounds || !root.current) return
    boardState().pushView()
    boardState().setViewport(fitBounds(bounds, root.current.clientWidth, root.current.clientHeight, 95))
  }
  const fitBoard = () => focus(unionBounds([...Object.values(board.items).map(i => i.transform), ...Object.values(board.frames).map(f => ({ ...f.bounds, y: f.bounds.y - 48, height: f.bounds.height + 48 }))]))
  const fitSelection = () => {
    if (selection?.kind === 'item') focus(board.items[selection.id]?.transform || null)
    if (selection?.kind === 'frame') focus(board.frames[selection.id]?.bounds || null)
    if (multiSelection.length) focus(unionBounds(multiSelection.map(id => board.items[id]?.transform).filter((bounds): bounds is Transform => !!bounds)))
  }
  const contentChange = (id: Id, value: string) => boardState().updateGesture(b => {
    const item = b.items[id]
    if (item?.type === 'text') { item.text = value; item.markdown = true }
    else if (item?.type === 'code') item.code = value
    else if (item?.type === 'formula') item.latex = value
    else if (b.frames[id]) b.frames[id].title = value
  })
  const objectDoubleClick = (kind: 'item' | 'frame', id: Id) => {
    if (boardState().editing === id) return
    const item = boardState().board.items[id]
    if (kind === 'frame' || item?.type === 'text' || item?.type === 'code' || item?.type === 'formula') { boardState().beginGesture(); boardState().setEditing(id) }
  }
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const files = [...event.dataTransfer.files].filter(f => f.type.startsWith('image/'))
    const p = worldPoint(event)
    files.forEach((file, index) => void addImage(file, { x: p.x + index*35, y: p.y + index*35 }))
  }
  const renameBoard = () => {
    setBoardMenu(false)
    setRenamingBoard(true)
  }
  const openBoard = async (id: string) => {
    if (id === boardState().board.id) { setBoardMenu(false); return }
    const next = await loadBoard(id)
    if (!next) return
    await saveBoard(boardState().board)
    boardState().setBoard(next)
    boardState().setSelection(null)
    boardState().setEditing(null)
    boardState().setViewport({ x: 100, y: 100, zoom: 1 })
    localStorage.setItem('spatial-learning-board.active', id)
    setBoardMenu(false)
  }
  const newBoard = async () => {
    await saveBoard(boardState().board)
    const fresh: Board = { id: uid(), version: 2, title: 'Untitled board', items: {}, frames: {}, frameEdges: {}, stories: {} }
    boardState().setBoard(fresh)
    boardState().setSelection(null)
    boardState().setEditing(null)
    boardState().setViewport({ x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 1 })
    localStorage.setItem('spatial-learning-board.active', fresh.id)
    setBoardList(list => [...list.filter(entry => entry.id !== fresh.id), { id: fresh.id, title: fresh.title }])
    setBoardMenu(false)
  }

  if (!ready) return <div className="loading">Opening board…</div>
  return <div className={`app tool-${tool} ${panning ? 'is-panning' : ''}`}>
    <div className="canvas-surface" ref={root} onPointerDownCapture={onSurfacePointerDownCapture} onPointerDown={onBackgroundDown} onAuxClick={e => { if (e.button === 1) e.preventDefault() }} onDrop={onDrop} onDragOver={e => e.preventDefault()}>
      <BoardRenderer board={board} viewport={viewport} mode="edit" selection={selection} multiSelection={multiSelection} editing={editing} onObjectDown={onObjectDown} onObjectDoubleClick={objectDoubleClick} onResizeDown={onResizeDown} onEdgeHandleDown={(event, id) => { gesture.current = { kind: 'connect', from: id }; setConnector({ from: id, ...worldPoint(event) }) }} onContentChange={contentChange} onTextHeightChange={(id, height) => boardState().updateGesture(b => { const item = b.items[id]; if (item?.type === 'text' && height > item.transform.height) item.transform.height = height })} onCodeLanguageChange={(id, language) => boardState().updateGesture(b => { const item = b.items[id]; if (item?.type === 'code') item.language = language })} onDoneEditing={finishEditing} />
      {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
      {!!snapGuides.length && <svg className="alignment-guides" aria-hidden="true">{snapGuides.map(line => line.axis === 'x'
        ? <line key="x" x1={line.position * viewport.zoom + viewport.x} x2={line.position * viewport.zoom + viewport.x} y1={line.start * viewport.zoom + viewport.y} y2={line.end * viewport.zoom + viewport.y} />
        : <line key="y" x1={line.start * viewport.zoom + viewport.x} x2={line.end * viewport.zoom + viewport.x} y1={line.position * viewport.zoom + viewport.y} y2={line.position * viewport.zoom + viewport.y} />)}</svg>}
      {!Object.keys(board.items).length && !Object.keys(board.frames).length && <div className="empty-hint">Choose Text, Code, Formula, Image, or Pen to begin</div>}
      {connector && <svg className="connector-preview"><line x1={(board.frames[connector.from]?.bounds.x || 0) * viewport.zoom + viewport.x} y1={((board.frames[connector.from]?.bounds.y || 0)-20) * viewport.zoom + viewport.y} x2={connector.x * viewport.zoom + viewport.x} y2={connector.y * viewport.zoom + viewport.y} /></svg>}
    </div>

    <header className="topbar"><div className="board-identity"><span className="brand-mark">◌</span><div className="board-menu-anchor">{renamingBoard ? <InlineRename value={board.title} label="Board title" className="board-name-input" onCommit={title => { boardState().change(b => { b.title = title }); setBoardList(list => list.map(entry => entry.id === board.id ? { ...entry, title } : entry)) }} onClose={() => setRenamingBoard(false)} /> : <button onClick={() => setBoardMenu(value => !value)} className="board-name">{board.title}<ChevronDown size={13} /></button>}{boardMenu && <div className="board-menu"><div className="menu-caption">BOARDS</div>{boardList.map(entry => <button key={entry.id} className={entry.id === board.id ? 'current' : ''} onClick={() => void openBoard(entry.id)}>{entry.title}</button>)}<div className="menu-rule" /><button onClick={() => void newBoard()}>+ New blank board</button><button onClick={renameBoard}>Rename current board</button></div>}</div><span className="save-state">{saveState}</span></div><div className="top-actions"><button className={`story-toggle ${showStory ? 'active' : ''}`} onClick={() => setShowStory(value => !value)}>Story</button><button title="How to use" onClick={() => setShowHelp(true)}><CircleHelp size={17} /></button></div></header>
    <div className="toolbar" role="toolbar" aria-label="Board tools">{tools.map((entry, index) => <div key={entry.id} className={index === 2 || index === 8 ? 'tool-divider' : ''}><button title={`${entry.label} · ${entry.shortcut}`} aria-label={entry.label} className={tool === entry.id ? 'active' : ''} onClick={() => { boardState().setTool(entry.id); if (entry.id === 'image') fileInput.current?.click() }}><entry.icon size={19} strokeWidth={1.75} /></button></div>)}</div>
    {!showStory && <div className="context-controls">
      {selection?.kind === 'item' && board.items[selection.id]?.type === 'text' && <><button title="Toggle bold" onClick={() => boardState().change(b => { const item = b.items[selection.id]; if (item?.type === 'text') item.bold = !item.bold })}>B</button><button title="Smaller text" onClick={() => boardState().change(b => { const item = b.items[selection.id]; if (item?.type === 'text') item.fontSize = Math.max(12, item.fontSize-2) })}>A−</button><button title="Larger text" onClick={() => boardState().change(b => { const item = b.items[selection.id]; if (item?.type === 'text') item.fontSize = Math.min(48, item.fontSize+2) })}>A+</button></>}
      {selection?.kind === 'item' && board.items[selection.id]?.type === 'drawing' && <><button title="Thinner stroke" onClick={() => boardState().change(b => { const item = b.items[selection.id]; if (item?.type === 'drawing') item.lineWidth = Math.max(1, item.lineWidth-1) })}>−</button><button title="Thicker stroke" onClick={() => boardState().change(b => { const item = b.items[selection.id]; if (item?.type === 'drawing') item.lineWidth = Math.min(12, item.lineWidth+1) })}>+</button></>}
      {(selection || multiSelection.length > 0) && <><button title="Fit selection" onClick={fitSelection}><Focus size={16} /></button><button title="Delete selected" onClick={removeSelection}><Trash2 size={16} /></button></>}
    </div>}
    <div className="view-controls"><button title="View back" disabled={!viewPast.length} onClick={() => boardState().viewBack()}><ArrowLeft size={17} /></button><button title="View forward" disabled={!viewFuture.length} onClick={() => boardState().viewForward()}><ArrowRight size={17} /></button><span className="control-separator" /><button title="Fit board" onClick={fitBoard}><Maximize2 size={17} /></button><button title="Zoom out" onClick={() => { const s = boardState(); s.pushView(); s.setViewport(zoomAt(s.viewport, window.innerWidth/2, window.innerHeight/2, clampZoom(s.viewport.zoom*.8))) }}>−</button><span className="zoom-label">{Math.round(viewport.zoom*100)}%</span><button title="Zoom in" onClick={() => { const s = boardState(); s.pushView(); s.setViewport(zoomAt(s.viewport, window.innerWidth/2, window.innerHeight/2, clampZoom(s.viewport.zoom/.8))) }}>+</button></div>
    <div className="history-controls"><button title="Undo · Cmd/Ctrl Z" disabled={!past.length} onClick={() => boardState().undo()}><Undo2 size={17} /></button><button title="Redo · Cmd/Ctrl Shift Z" disabled={!future.length} onClick={() => boardState().redo()}><Redo2 size={17} /></button></div>
    <div className="board-hint">{tool === 'frame' ? 'Drag to mark a region' : tool === 'edge' ? 'Drag from a frame title to another frame' : tool === 'pen' ? 'Draw directly on the board' : tool === 'eraser' ? 'Click a stroke to erase' : tool === 'code' ? 'Click to place a code block' : tool === 'text' ? 'Click to place a Markdown note · type $...$ for inline math' : 'Drag empty space to select · Touch and drag to pan · Pinch to zoom'}</div>
    <input ref={fileInput} className="file-input" type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) void addImage(file, imagePosition || undefined); e.target.value = ''; setImagePosition(null) }} />
    {showStory && <StoryPanel board={board} viewport={viewport} activeStoryId={activeStoryId} onStoryChange={setActiveStoryId} onPresent={setPresentingStoryId} onClose={() => setShowStory(false)} onFocusFrame={(id, bounds) => focus(bounds || board.frames[id]?.bounds || null)} />}
    {presentingStoryId && board.stories[presentingStoryId]?.steps.length ? <Suspense fallback={<div className="loading presentation-loading">Opening story…</div>}><Presentation board={board} story={board.stories[presentingStoryId]} onClose={() => { setPresentingStoryId(null); if (document.fullscreenElement) void document.exitFullscreen() }} /></Suspense> : null}
    {showHelp && <div className="modal-backdrop" onPointerDown={e => e.stopPropagation()}><div className="help-modal"><button className="modal-close" onClick={() => setShowHelp(false)}>×</button><span className="eyebrow">TRACE</span><h2>Think on the board.</h2><p>Place notes, code, images, formulas, and sketches anywhere. Draw a frame when a local idea has a name. Frames mark space; moving one never moves its content.</p><div className="help-grid"><span>Select several</span><span>Drag an empty part of the board</span><span>Move around</span><span>Middle button or Space + drag; one finger on empty space; trackpad scroll</span><span>Align objects</span><span>Drag near another edge or center; hold Alt to skip snapping</span><span>Zoom</span><span>Two finger pinch, mouse wheel, or zoom controls</span><span>Edit content</span><span>Double-click or double-tap; tap elsewhere to finish</span><span>Inline formula</span><span>Type $...$ in a Markdown note to render inline math</span><span>Code block</span><span>Press C, click the board, then choose a language</span><span>Formula source</span><span>Type LaTeX inside the selected formula box</span><span>Connect frames</span><span>Drag ↗ beside a frame title</span><span>Present</span><span>Open Story, build a path, then Present</span><span>Undo / Redo</span><span>⌘/Ctrl Z · ⌘/Ctrl Shift Z</span></div><button className="done-button" onClick={() => setShowHelp(false)}>Return to board</button></div></div>}
  </div>
}
