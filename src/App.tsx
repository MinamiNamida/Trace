import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, CircleHelp, ClipboardPaste, Copy, Scissors, Group, Ungroup, Code2, Eraser, Focus, Frame, Hand, ImagePlus, Maximize2, MousePointer2, PenLine, Redo2, Sigma, Trash2, Type, Undo2, Waypoints } from 'lucide-react'
import { BoardRenderer } from './BoardRenderer'
import { ContextMenu } from './ContextMenu'
import type { MenuAction } from './ContextMenu'
import { boundsFor, canGroup, createClip, expandGroups, frameChildren, groupObjects, insertClip, reconcileFrame, reconcileFrames, removeObjects, rootIds, selectedGroups, selectedIds, selectionBounds, ungroupObjects, withFrameChildren, wrapInFrame } from './boardOperations'
import type { BoardClip } from './boardOperations'
import { parseClip, recalledClip, rememberClip, restoreClipAssets, writeClip } from './boardClipboard'
import { snapMove, snapResize } from './alignment'
import type { AlignmentGuide } from './alignment'
import { createGuideBoard, isOriginalDemoBoard, GUIDE_START_FRAME } from './demo'
import { StoryPanel } from './StoryPanel'
import { InlineRename } from './InlineRename'
import { boardState, useBoard } from './store'
import { clampZoom, fitBounds, screenToWorld, uid, unionBounds, zoomAt } from './model'
import type { Board, CanvasItem, Id, Selection, Tool, Transform, Viewport } from './model'
import { deleteBoard, listBoards, loadBoard, saveAsset, saveBoard } from './storage'

type Gesture =
  | { kind: 'pan'; x: number; y: number; viewport: Viewport; pointerId: number; moved: boolean }
  | { kind: 'marquee'; x: number; y: number; currentX: number; currentY: number }
  | { kind: 'createEdit'; id: Id }
  | { kind: 'moveMulti'; x: number; y: number; originals: Record<Id, Transform>; started: boolean; primary: { kind: 'item' | 'frame'; id: Id } }
  | { kind: 'resize'; target: Exclude<Selection, null>; x: number; y: number; original: Transform; originalPoints?: { x: number; y: number; pressure?: number }[]; started: boolean }
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; world: { x: number; y: number } } | null>(null)
  const [notice, setNotice] = useState('')
  const clipboardBusy = useRef(false)
  const [ready, setReady] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [connector, setConnector] = useState<{ from: Id; x: number; y: number } | null>(null)
  const [imagePosition, setImagePosition] = useState<{ x: number; y: number } | null>(null)
  const [saveState, setSaveState] = useState('Saved locally')
  const saveTimer = useRef(0)
  const boardOperation = useRef(false)
  const [boardBusy, setBoardBusy] = useState(false)
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
      const entries = await listBoards()
      const existing = stored || await loadBoard(entries[0]?.id || 'main')
      const replaceDemo = existing ? await isOriginalDemoBoard(existing) : false
      const initial = !existing || replaceDemo ? await createGuideBoard(existing?.id) : existing
      if (!active) return
      if (!stored || replaceDemo) await saveBoard(initial)
      if (!active) return
      boardState().setBoard(initial)
      if (!initial.frameMembership) await saveBoard(boardState().board)
      if (!active) return
      localStorage.setItem('spatial-learning-board.active', initial.id)
      setBoardList([...(await listBoards()).filter(entry => entry.id !== initial.id), { id: initial.id, title: initial.title }])
      const bounds = unionBounds([...Object.values(initial.items).map(i => i.transform), ...Object.values(initial.frames).map(f => ({ ...f.bounds, y: f.bounds.y - 48, height: f.bounds.height + 48 }))])
      if (!existing || replaceDemo) boardState().setViewport(fitBounds(initial.frames[GUIDE_START_FRAME].bounds, window.innerWidth, window.innerHeight, 110))
      else if (bounds) boardState().setViewport(fitBounds(bounds, window.innerWidth, window.innerHeight, 76))
      const requestedStory = query.get('story')
      if (requestedStory && initial.stories[requestedStory]?.steps.length) setPresentingStoryId(requestedStory)
      setReady(true)
    })().catch(error => { if (active) setSaveState(`Could not open board: ${error instanceof Error ? error.message : String(error)}`) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!ready || boardBusy) return
    let active = true
    setSaveState('Saving…')
    saveTimer.current = window.setTimeout(() => saveBoard(board).then(() => { if (active) setSaveState('Saved locally') }).catch(() => { if (active) setSaveState('Save failed') }), 450)
    return () => { active = false; clearTimeout(saveTimer.current) }
  }, [board, ready, boardBusy])

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
    if (event.button === 2) return
    setContextMenu(null)
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
    const boardId = boardState().board.id
    const id = uid()
    await saveAsset(id, file)
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.src = url
    await image.decode().catch(() => {})
    const ratio = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1.5
    URL.revokeObjectURL(url)
    if (boardState().board.id !== boardId) return
    const width = Math.min(540, Math.max(220, image.naturalWidth || 420))
    const point = at || screenToWorld(window.innerWidth / 2, window.innerHeight / 2, boardState().viewport)
    const item: CanvasItem = { id, type: 'image', assetId: id, alt: file.name, transform: { x: point.x, y: point.y, width, height: width / ratio } }
    boardState().change(board => { board.items[id] = item; reconcileFrames(board, [id]) })
    boardState().setSelection({ kind: 'item', id })
    boardState().setTool('select')
  }

  const chooseObjects = (ids: Id[], expand = true) => {
    const state = boardState()
    const next = expand ? expandGroups(state.board, ids) : ids.filter(id => !!boundsFor(state.board, id))
    if (next.length === 1) state.setSelection({ kind: state.board.frames[next[0]] ? 'frame' : 'item', id: next[0] })
    else state.setMultiSelection(next)
  }
  const currentIds = () => selectedIds(boardState().selection, boardState().multiSelection)
  const removeSelection = () => {
    const state = boardState()
    const ids = currentIds()
    if (state.selection?.kind === 'edge') ids.push(state.selection.id)
    if (!ids.length) return
    state.change(board => removeObjects(board, ids))
    state.setSelection(null)
  }
  const groupSelection = () => {
    const ids = currentIds()
    if (!canGroup(boardState().board, ids)) return
    boardState().change(board => groupObjects(board, ids))
    chooseObjects(ids)
  }
  const ungroupSelection = () => {
    const ids = currentIds()
    if (!selectedGroups(boardState().board, ids).length) return
    boardState().change(board => ungroupObjects(board, ids))
    chooseObjects(ids)
  }
  const duplicateSelection = () => {
    const state = boardState(), ids = currentIds()
    if (!ids.length) return
    const clip = createClip(state.board, ids)
    let inserted: Id[] = []
    state.change(board => { inserted = insertClip(board, clip) })
    chooseObjects(inserted)
  }
  const copySelection = async (cut = false) => {
    const state = boardState(), ids = currentIds()
    if (!ids.length || clipboardBusy.current) return
    const clip = createClip(state.board, ids)
    rememberClip(clip)
    if (cut) removeSelection()
    clipboardBusy.current = true
    try { await writeClip(clip); setNotice(cut ? '已剪切' : '已复制') }
    catch { setNotice('已复制到画板剪贴板，可用右键菜单粘贴；系统剪贴板未获授权。') }
    finally { clipboardBusy.current = false }
  }
  const pasteClip = async (clip: BoardClip, at?: { x: number; y: number }) => {
    const boardId = boardState().board.id
    const restored = await restoreClipAssets(clip)
    if (boardState().board.id !== boardId) return
    const point = at || screenToWorld(window.innerWidth / 2, window.innerHeight / 2, boardState().viewport)
    let inserted: Id[] = []
    boardState().change(board => { inserted = insertClip(board, restored, point) })
    boardState().setTool('select'); chooseObjects(inserted)
  }
  const pasteText = (text: string, at?: { x: number; y: number }) => {
    const id = uid(), point = at || screenToWorld(window.innerWidth / 2, window.innerHeight / 2, boardState().viewport)
    boardState().change(board => {
      board.items[id] = { id, type: 'text', text, markdown: true, fontSize: 20, transform: { ...point, width: 420, height: 100 } }
      reconcileFrames(board, [id])
    })
    boardState().setTool('select'); chooseObjects([id])
  }
  const pasteFromMenu = async (at: { x: number; y: number }) => {
    const boardId = boardState().board.id
    try {
      if (!navigator.clipboard.read) {
        const text = await navigator.clipboard.readText()
        if (boardState().board.id !== boardId) return
        const clip = parseClip(text)
        if (clip) await pasteClip(clip, at)
        else if (text.trim()) pasteText(text, at)
        return
      }
      const data = await navigator.clipboard.read()
      if (boardState().board.id !== boardId) return
      for (const entry of data) {
        const text = entry.types.includes('text/plain') ? await (await entry.getType('text/plain')).text() : ''
        if (boardState().board.id !== boardId) return
        const clip = parseClip(text)
        if (clip) { await pasteClip(clip, at); return }
        const type = entry.types.find(type => type.startsWith('image/'))
        if (type) {
          const blob = await entry.getType(type)
          if (boardState().board.id !== boardId) return
          await addImage(new File([blob], 'Pasted image', { type }), at); return
        }
        if (text.trim()) { pasteText(text, at); return }
      }
      setNotice('剪贴板中没有可粘贴的画板内容、文字或图片。')
    } catch {
      if (boardState().board.id !== boardId) return
      const clip = recalledClip()
      if (clip) { await pasteClip(clip, at); return }
      setNotice('浏览器未允许读取剪贴板，请用 ⌘ / Ctrl V 粘贴。')
    }
  }
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement
      if (boardState().editing || target.closest?.('input, textarea, [contenteditable="true"], .presentation-shell')) return
      const text = event.clipboardData?.getData('text/plain') || ''
      const clip = parseClip(text)
      const file = [...(event.clipboardData?.files || [])].find(file => file.type.startsWith('image/'))
      if (clip || file || text.trim()) {
        event.preventDefault(); setContextMenu(null)
        if (clip) void pasteClip(clip).catch(() => setNotice('粘贴失败，请重试。'))
        else if (file) void addImage(file)
        else pasteText(text)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])

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
      if (inField || state.editing || target.closest?.('.presentation-shell') || document.querySelector('.presentation-shell')) return
      if (event.code === 'Space') { event.preventDefault(); space.current = true; return }
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? state.redo() : state.undo(); return }
      if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); state.redo(); return }
      if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); chooseObjects([...Object.keys(state.board.items), ...Object.keys(state.board.frames)]); return }
      if (mod && event.key.toLowerCase() === 'g') { event.preventDefault(); event.shiftKey ? ungroupSelection() : groupSelection(); return }
      if (mod && ['c', 'x'].includes(event.key.toLowerCase())) { event.preventDefault(); void copySelection(event.key.toLowerCase() === 'x'); return }
      if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelection(); return }
      if (event.key === 'Escape') { setContextMenu(null); state.setSelection(null); state.setTool('select'); return }
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
    if (state.tool === 'eraser' && kind === 'item' && state.board.items[id]?.type === 'drawing') { state.change(b => removeObjects(b, [id])); return }
    if (state.tool === 'edge' && kind === 'frame') { gesture.current = { kind: 'connect', from: id }; setConnector({ from: id, ...worldPoint(event) }); return }
    if (state.editing === id || (state.tool !== 'select' && state.tool !== 'eraser')) return
    if (kind === 'edge') { state.setSelection({ kind, id }); return }
    const current = currentIds()
    const unit = event.ctrlKey || event.metaKey ? [id] : expandGroups(state.board, [id])
    if (event.shiftKey) {
      const selected = unit.every(member => current.includes(member))
      chooseObjects(selected ? current.filter(member => !unit.includes(member)) : [...new Set([...current, ...unit])], false)
      return
    }
    if (!current.includes(id) || event.ctrlKey || event.metaKey) chooseObjects(unit, false)
    const ids = withFrameChildren(state.board, currentIds())
    const p = screenPoint(event)
    gesture.current = { kind: 'moveMulti', primary: { kind, id }, x: p.x, y: p.y, originals: Object.fromEntries(ids.map(id => [id, { ...boundsFor(state.board, id)! }])), started: false }
  }

  const onResizeDown = (event: React.PointerEvent, kind: 'item' | 'frame', id: Id) => {
    event.stopPropagation()
    if (event.button !== 0 || pinch.current) return
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
        state.updateGesture(b => { for (const [id, original] of Object.entries(g.originals)) { const next = { ...original, x: original.x + moveX, y: original.y + moveY }; if (b.items[id]) b.items[id].transform = next; else if (b.frames[id]) b.frames[id].bounds = next } })
      } else if (g.kind === 'resize') {
        const dx = (p.x - g.x) / state.viewport.zoom, dy = (p.y - g.y) / state.viewport.zoom
        if (!g.started && Math.hypot(dx, dy) < 2) return
        if (!g.started) { state.beginGesture(); g.started = true }
        const original = g.original
        const item = g.target.kind === 'item' ? state.board.items[g.target.id] : undefined
        let next: Transform
        if (item?.type === 'image') { const ratio = original.width / original.height; const width = Math.max(64, original.width + dx); next = { ...original, width, height: width / ratio } }
        else next = { ...original, width: Math.max(60, original.width + dx), height: Math.max(35, original.height + dy) }
        const references = alignmentReferences(state.board, new Set([g.target.id]))
        const snapped = event.altKey ? { bounds: next, guides: [] } : snapResize(next, references, state.viewport.zoom, item?.type === 'image' ? 64 : 60, 35, item?.type === 'image' ? original.width / original.height : undefined)
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
      if (event.pointerType === 'touch' && g.kind === 'moveMulti' && !g.started) {
        const previous = lastTouchTap.current
        const now = Date.now()
        if (previous?.id === g.primary.id && now - previous.time < 400) {
          const item = state.board.items[g.primary.id]
          if (g.primary.kind === 'frame' || item?.type === 'text' || item?.type === 'code' || item?.type === 'formula') {
            state.beginGesture(); state.setEditing(g.primary.id)
          }
          lastTouchTap.current = null
        } else lastTouchTap.current = { id: g.primary.id, time: now }
      }
      if (g.kind === 'createEdit') { state.updateGesture(board => reconcileFrames(board, [g.id])); state.setEditing(g.id) }
      if (g.kind === 'moveMulti' && g.started) state.updateGesture(board => reconcileFrames(board, Object.keys(g.originals).filter(id => !board.items[id]?.frameId || !g.originals[board.items[id].frameId!])) )
      if (g.kind === 'resize' && g.started) state.updateGesture(board => { if (g.target.kind === 'frame') reconcileFrame(board, g.target.id); else reconcileFrames(board, [g.target.id]) })
      if (g.kind === 'draw') state.updateGesture(board => reconcileFrames(board, [g.id]))
      if (g.kind === 'marquee') {
        const a = screenToWorld(Math.min(g.x, g.currentX), Math.min(g.y, g.currentY), state.viewport)
        const b = screenToWorld(Math.max(g.x, g.currentX), Math.max(g.y, g.currentY), state.viewport)
        if (Math.hypot(g.currentX-g.x, g.currentY-g.y) > 3) {
          const ids = [...Object.keys(state.board.items), ...Object.keys(state.board.frames)].filter(id => { const bounds = boundsFor(state.board, id)!; return bounds.x >= a.x && bounds.x + bounds.width <= b.x && bounds.y >= a.y && bounds.y + bounds.height <= b.y })
          chooseObjects(rootIds(state.board, ids))
        }
        setMarquee(null)
      }
      if (g.kind === 'frame') { state.updateGesture(board => reconcileFrame(board, g.id)); state.setEditing(g.id); state.setTool('select') }
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
      if (target.closest?.('.presentation-shell')) return
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
    if (multiSelection.length) focus(selectionBounds(board, multiSelection))
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
  const activateBoard = (next: Board) => {
    boardState().setBoard(next)
    const bounds = unionBounds([...Object.values(next.items).map(item => item.transform), ...Object.values(next.frames).map(frame => ({ ...frame.bounds, y: frame.bounds.y - 48, height: frame.bounds.height + 48 }))])
    boardState().setViewport(bounds ? fitBounds(bounds, window.innerWidth, window.innerHeight, 76) : { x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 1 })
    localStorage.setItem('spatial-learning-board.active', next.id)
    const url = new URL(window.location.href)
    url.searchParams.set('board', next.id)
    url.searchParams.delete('story')
    url.searchParams.delete('print-pdf')
    window.history.replaceState(null, '', url)
    setContextMenu(null)
    setActiveStoryId(null)
    setPresentingStoryId(null)
    setRenamingBoard(false)
    setBoardMenu(false)
    gesture.current = null
    newItemIds.current.clear()
    setConnector(null)
    setMarquee(null)
    setSnapGuides([])
  }
  const manageBoards = async (action: () => Promise<void>) => {
    if (boardOperation.current) return
    boardOperation.current = true
    clearTimeout(saveTimer.current)
    setBoardBusy(true)
    finishEditing()
    try {
      await action()
      setBoardList(await listBoards())
    } catch (error) {
      window.alert(`Could not update boards: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      boardOperation.current = false
      setBoardBusy(false)
    }
  }
  const openBoard = (id: string) => manageBoards(async () => {
    if (id === boardState().board.id) { setBoardMenu(false); return }
    await saveBoard(boardState().board)
    let next = await loadBoard(id)
    if (!next) throw new Error('This board no longer exists.')
    const replaceDemo = await isOriginalDemoBoard(next)
    if (replaceDemo) { next = await createGuideBoard(next.id); await saveBoard(next) }
    activateBoard(next)
    if (replaceDemo) boardState().setViewport(fitBounds(next.frames[GUIDE_START_FRAME].bounds, window.innerWidth, window.innerHeight, 110))
  })
  const blankBoard = (): Board => ({ id: uid(), version: 2, title: 'Untitled board', items: {}, frames: {}, frameEdges: {}, stories: {}, frameMembership: true })
  const newBoard = () => manageBoards(async () => {
    await saveBoard(boardState().board)
    const fresh = blankBoard()
    await saveBoard(fresh)
    activateBoard(fresh)
  })
  const removeBoard = (id: string, title: string) => {
    if (boardOperation.current || !window.confirm(`Delete “${title}”? This permanently deletes this board and its stories.`)) return
    return manageBoards(async () => {
      const current = boardState().board
      if (current.id === id) {
        const remaining = (await listBoards()).find(entry => entry.id !== id)
        const next = (remaining && await loadBoard(remaining.id)) || blankBoard()
        await saveBoard(next)
        await deleteBoard(id)
        activateBoard(next)
      } else {
        await saveBoard(current)
        await deleteBoard(id)
      }
    })
  }

  const openContextMenu = (event: React.MouseEvent) => {
    const target = event.target as Element
    if (target.closest('input, textarea, [contenteditable="true"], .canvas-item.editing')) return
    event.preventDefault(); event.stopPropagation()
    finishEditing()
    gesture.current = null; gesturePointer.current = null; setMarquee(null); setSnapGuides([]); setConnector(null)
    const object = target.closest<HTMLElement>('[data-item-id], [data-frame-id], [data-edge-id]')
    const id = object?.dataset.itemId || object?.dataset.frameId || object?.dataset.edgeId
    if (id) {
      if (object?.dataset.edgeId) boardState().setSelection({ kind: 'edge', id })
      else if (!currentIds().includes(id)) chooseObjects([id])
    } else boardState().setSelection(null)
    setContextMenu({ x: event.clientX, y: event.clientY, world: worldPoint(event) })
  }
  const ids = selectedIds(selection, multiSelection)
  const frameId = selection?.kind === 'frame' ? selection.id : null
  const command = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'
  const menuActions: MenuAction[] = [
    { label: '撤销', icon: Undo2, shortcut: `${command}Z`, disabled: !past.length, run: () => boardState().undo() },
    { label: '重做', icon: Redo2, shortcut: `${command}⇧Z`, disabled: !future.length, run: () => boardState().redo() },
    'separator',
    { label: '剪切', icon: Scissors, shortcut: `${command}X`, disabled: !ids.length, run: () => void copySelection(true) },
    { label: '复制', icon: Copy, shortcut: `${command}C`, disabled: !ids.length, run: () => void copySelection() },
    { label: '粘贴', icon: ClipboardPaste, shortcut: `${command}V`, run: () => { if (contextMenu) void pasteFromMenu(contextMenu.world).catch(() => setNotice('粘贴失败，请重试。')) } },
  ]
  if (ids.length) menuActions.push(
    { label: '创建副本', icon: Copy, shortcut: `${command}D`, run: duplicateSelection },
    'separator',
    { label: '编组', icon: Group, shortcut: `${command}G`, disabled: !canGroup(board, ids), run: groupSelection },
    { label: '取消编组', icon: Ungroup, shortcut: `${command}⇧G`, disabled: !selectedGroups(board, ids).length, run: ungroupSelection },
  )
  if (ids.length && !ids.some(id => !!board.frames[id])) menuActions.push({ label: '将所选内容放入 Frame', icon: Frame, run: () => {
    let id: Id | null = null
    boardState().change(board => { id = wrapInFrame(board, currentIds()) })
    if (id) chooseObjects([id])
  } })
  if (frameId) menuActions.push(
    { label: '选择 Frame 内所有内容', icon: MousePointer2, disabled: !frameChildren(board, frameId).length, run: () => chooseObjects(frameChildren(boardState().board, frameId)) },
    { label: '解除 Frame 内容绑定', icon: Ungroup, disabled: !frameChildren(board, frameId).length, run: () => boardState().change(board => { for (const id of frameChildren(board, frameId)) delete board.items[id].frameId }) },
    { label: '移除 Frame，保留内容', icon: Frame, run: () => { boardState().change(board => removeObjects(board, [frameId], false)); boardState().setSelection(null) } },
  )
  if (selection && selection.kind !== 'edge' && (selection.kind === 'frame' || ['text', 'code', 'formula'].includes(board.items[selection.id]?.type))) menuActions.push({ label: selection.kind === 'frame' ? '重命名 Frame' : '编辑内容', icon: Type, run: () => objectDoubleClick(selection.kind as 'item' | 'frame', selection.id) })
  menuActions.push('separator',
    { label: '全选', icon: MousePointer2, shortcut: `${command}A`, disabled: !Object.keys(board.items).length && !Object.keys(board.frames).length, run: () => chooseObjects([...Object.keys(boardState().board.items), ...Object.keys(boardState().board.frames)]) },
    { label: ids.length ? '聚焦所选内容' : '查看整张画板', icon: Focus, run: ids.length ? fitSelection : fitBoard },
  )
  if (selection || ids.length) menuActions.push('separator', { label: frameId ? '删除 Frame 及内容' : '删除所选内容', icon: Trash2, shortcut: '⌫', danger: true, run: removeSelection })

  if (!ready) return <div className="loading">{saveState.startsWith('Could not') ? saveState : 'Opening board…'}</div>
  return <div className={`app tool-${tool} ${panning ? 'is-panning' : ''}`}>
    <div className="canvas-surface" ref={root} onPointerDownCapture={onSurfacePointerDownCapture} onPointerDown={onBackgroundDown} onContextMenu={openContextMenu} onAuxClick={e => { if (e.button === 1) e.preventDefault() }} onDrop={onDrop} onDragOver={e => e.preventDefault()}>
      <BoardRenderer board={board} viewport={viewport} mode="edit" selection={selection} multiSelection={multiSelection} editing={editing} onObjectDown={onObjectDown} onObjectDoubleClick={objectDoubleClick} onResizeDown={onResizeDown} onEdgeHandleDown={(event, id) => { if (event.button !== 0) return; gesturePointer.current = event.pointerId; gesture.current = { kind: 'connect', from: id }; setConnector({ from: id, ...worldPoint(event) }) }} onContentChange={contentChange} onTextHeightChange={(id, height) => boardState().updateGesture(b => { const item = b.items[id]; if (item?.type === 'text' && height > item.transform.height) item.transform.height = height })} onCodeLanguageChange={(id, language) => boardState().updateGesture(b => { const item = b.items[id]; if (item?.type === 'code') item.language = language })} onDoneEditing={finishEditing} />
      {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} />}
      {!!snapGuides.length && <svg className="alignment-guides" aria-hidden="true">{snapGuides.map(line => line.axis === 'x'
        ? <line key="x" x1={line.position * viewport.zoom + viewport.x} x2={line.position * viewport.zoom + viewport.x} y1={line.start * viewport.zoom + viewport.y} y2={line.end * viewport.zoom + viewport.y} />
        : <line key="y" x1={line.start * viewport.zoom + viewport.x} x2={line.end * viewport.zoom + viewport.x} y1={line.position * viewport.zoom + viewport.y} y2={line.position * viewport.zoom + viewport.y} />)}</svg>}
      {!Object.keys(board.items).length && !Object.keys(board.frames).length && <div className="empty-hint">Choose Text, Code, Formula, Image, or Pen to begin</div>}
      {connector && <svg className="connector-preview"><line x1={(board.frames[connector.from]?.bounds.x || 0) * viewport.zoom + viewport.x} y1={((board.frames[connector.from]?.bounds.y || 0)-20) * viewport.zoom + viewport.y} x2={connector.x * viewport.zoom + viewport.x} y2={connector.y * viewport.zoom + viewport.y} /></svg>}
    </div>

    <header className="topbar"><div className="board-identity"><span className="brand-mark">◌</span><div className="board-menu-anchor">{renamingBoard ? <InlineRename value={board.title} label="Board title" className="board-name-input" onCommit={title => { boardState().change(b => { b.title = title }); setBoardList(list => list.map(entry => entry.id === board.id ? { ...entry, title } : entry)) }} onClose={() => setRenamingBoard(false)} /> : <button onClick={() => setBoardMenu(value => !value)} className="board-name">{board.title}<ChevronDown size={13} /></button>}{boardMenu && <div className="board-menu"><div className="menu-caption">BOARDS</div>{boardList.map(entry => <div key={entry.id} className="board-menu-row"><button disabled={boardBusy} className={entry.id === board.id ? 'current' : ''} onClick={() => void openBoard(entry.id)}>{entry.title}</button><button disabled={boardBusy} className="board-delete" title={`Delete board: ${entry.title}`} aria-label={`Delete board: ${entry.title}`} onClick={() => void removeBoard(entry.id, entry.title)}><Trash2 size={14} /></button></div>)}<div className="menu-rule" /><button disabled={boardBusy} onClick={() => void newBoard()}>+ New blank board</button><button disabled={boardBusy} onClick={renameBoard}>Rename current board</button></div>}</div><span className="save-state">{saveState}</span></div><div className="top-actions"><button className={`story-toggle ${showStory ? 'active' : ''}`} onClick={() => setShowStory(value => !value)}>Story</button><button title="How to use" onClick={() => setShowHelp(true)}><CircleHelp size={17} /></button></div></header>
    {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} actions={menuActions} onClose={() => setContextMenu(null)} />}
    {notice && <div className="canvas-notice" role="status">{notice}</div>}
    <div className="toolbar" role="toolbar" aria-label="Board tools">{tools.map((entry, index) => <div key={entry.id} className={index === 2 || index === 8 ? 'tool-divider' : ''}><button title={`${entry.label} · ${entry.shortcut}`} aria-label={entry.label} className={tool === entry.id ? 'active' : ''} onClick={() => { boardState().setTool(entry.id); if (entry.id === 'image') fileInput.current?.click() }}><entry.icon size={19} strokeWidth={1.75} /></button></div>)}</div>
    {!showStory && <div className="context-controls">
      {selection?.kind === 'item' && board.items[selection.id]?.type === 'text' && <><button title="Toggle bold" onClick={() => boardState().change(b => { const item = b.items[selection.id]; if (item?.type === 'text') item.bold = !item.bold })}>B</button><button title="Smaller text" onClick={() => boardState().change(b => { const item = b.items[selection.id]; if (item?.type === 'text') item.fontSize = Math.max(12, item.fontSize-2) })}>A−</button><button title="Larger text" onClick={() => boardState().change(b => { const item = b.items[selection.id]; if (item?.type === 'text') item.fontSize = Math.min(48, item.fontSize+2) })}>A+</button></>}
      {selection?.kind === 'item' && board.items[selection.id]?.type === 'drawing' && <><button title="Thinner stroke" onClick={() => boardState().change(b => { const item = b.items[selection.id]; if (item?.type === 'drawing') item.lineWidth = Math.max(1, item.lineWidth-1) })}>−</button><button title="Thicker stroke" onClick={() => boardState().change(b => { const item = b.items[selection.id]; if (item?.type === 'drawing') item.lineWidth = Math.min(12, item.lineWidth+1) })}>+</button></>}
      {(selection || multiSelection.length > 0) && <><button title="Fit selection" onClick={fitSelection}><Focus size={16} /></button>{canGroup(board, ids) && <button title="编组 · Cmd/Ctrl G" onClick={groupSelection}><Group size={16} /></button>}{selectedGroups(board, ids).length > 0 && <button title="取消编组 · Cmd/Ctrl Shift G" onClick={ungroupSelection}><Ungroup size={16} /></button>}<button title="Delete selected" onClick={removeSelection}><Trash2 size={16} /></button></>}
    </div>}
    <div className="view-controls"><button title="View back" disabled={!viewPast.length} onClick={() => boardState().viewBack()}><ArrowLeft size={17} /></button><button title="View forward" disabled={!viewFuture.length} onClick={() => boardState().viewForward()}><ArrowRight size={17} /></button><span className="control-separator" /><button title="Fit board" onClick={fitBoard}><Maximize2 size={17} /></button><button title="Zoom out" onClick={() => { const s = boardState(); s.pushView(); s.setViewport(zoomAt(s.viewport, window.innerWidth/2, window.innerHeight/2, clampZoom(s.viewport.zoom*.8))) }}>−</button><span className="zoom-label">{Math.round(viewport.zoom*100)}%</span><button title="Zoom in" onClick={() => { const s = boardState(); s.pushView(); s.setViewport(zoomAt(s.viewport, window.innerWidth/2, window.innerHeight/2, clampZoom(s.viewport.zoom/.8))) }}>+</button></div>
    <div className="history-controls"><button title="Undo · Cmd/Ctrl Z" disabled={!past.length} onClick={() => boardState().undo()}><Undo2 size={17} /></button><button title="Redo · Cmd/Ctrl Shift Z" disabled={!future.length} onClick={() => boardState().redo()}><Redo2 size={17} /></button></div>
    <div className="board-hint">{tool === 'frame' ? 'Drag to mark a region' : tool === 'edge' ? 'Drag from a frame title to another frame' : tool === 'pen' ? 'Draw directly on the board' : tool === 'eraser' ? 'Click a stroke to erase' : tool === 'code' ? 'Click to place a code block' : tool === 'text' ? 'Click to place a Markdown note · type $...$ for inline math' : 'Drag empty space to select · Touch and drag to pan · Pinch to zoom'}</div>
    <input ref={fileInput} className="file-input" type="file" accept="image/*" onChange={e => { const file = e.target.files?.[0]; if (file) void addImage(file, imagePosition || undefined); e.target.value = ''; setImagePosition(null) }} />
    {showStory && <StoryPanel key={board.id} board={board} viewport={viewport} activeStoryId={activeStoryId} onStoryChange={setActiveStoryId} onPresent={setPresentingStoryId} onClose={() => setShowStory(false)} onFocusFrame={(id, bounds) => focus(bounds || board.frames[id]?.bounds || null)} />}
    {presentingStoryId && board.stories[presentingStoryId]?.steps.length ? <Suspense fallback={<div className="loading presentation-loading">Opening story…</div>}><Presentation board={board} story={board.stories[presentingStoryId]} onClose={() => { setPresentingStoryId(null); if (document.fullscreenElement) void document.exitFullscreen() }} /></Suspense> : null}
    {showHelp && <div className="modal-backdrop" onPointerDown={e => e.stopPropagation()}><div className="help-modal"><button className="modal-close" onClick={() => setShowHelp(false)}>×</button><span className="eyebrow">TRACE</span><h2>Think on the board.</h2><p>Place notes, code, images, formulas, and sketches anywhere. Draw a frame when a local idea has a name. Frames keep their contents together; moving a frame moves its content. Group blocks to select and move them as one.</p><div className="help-grid"><span>Select several</span><span>Drag an empty part of the board, or Shift + click</span><span>Group / Ungroup</span><span>⌘/Ctrl G · ⌘/Ctrl Shift G (one nesting level at a time)</span><span>Copy / Cut / Paste</span><span>⌘/Ctrl C · X · V, or right-click the canvas</span><span>Select in a group</span><span>⌘/Ctrl + click selects one member; double-click to edit</span><span>Move around</span><span>Middle button or Space + drag; one finger on empty space; trackpad scroll</span><span>Align objects</span><span>Drag near another edge or center; hold Alt to skip snapping</span><span>Zoom</span><span>Two finger pinch, mouse wheel, or zoom controls</span><span>Edit content</span><span>Double-click or double-tap; tap elsewhere to finish</span><span>Inline formula</span><span>Type $...$ in a Markdown note to render inline math</span><span>Code block</span><span>Press C, click the board, then choose a language</span><span>Formula source</span><span>Type LaTeX inside the selected formula box</span><span>Connect frames</span><span>Drag ↗ beside a frame title</span><span>Present</span><span>Open Story, build a path, then Present</span><span>Undo / Redo</span><span>⌘/Ctrl Z · ⌘/Ctrl Shift Z</span></div><button className="done-button" onClick={() => setShowHelp(false)}>Return to board</button></div></div>}
  </div>
}
