import { current, isDraft } from 'immer'
import { ArrowLeft, ArrowRight, Copy, Download, Ellipsis, FileText, Play, Printer, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { InlineRename } from './InlineRename'
import { screenToWorld, uid } from './model'
import type { Board, CanvasItem, Frame, Id, StoryStep, Transform, Viewport } from './model'
import { boardState } from './store'
import { openPrintWindow } from './printWindow'

function frameOrder(board: Board): Frame[] {
  const frames = Object.values(board.frames)
  const indegree = Object.fromEntries(frames.map(frame => [frame.id, 0]))
  for (const edge of Object.values(board.frameEdges)) if (edge.to in indegree) indegree[edge.to]++
  const queue = frames.filter(frame => indegree[frame.id] === 0)
  const result: Frame[] = []
  while (queue.length) {
    const frame = queue.shift()!
    result.push(frame)
    for (const edge of Object.values(board.frameEdges).filter(edge => edge.from === frame.id)) {
      if (edge.to in indegree && --indegree[edge.to] === 0 && board.frames[edge.to]) queue.push(board.frames[edge.to])
    }
  }
  return [...result, ...frames.filter(frame => !result.some(existing => existing.id === frame.id))]
}

function itemLabel(item: CanvasItem) {
  const value = item.type === 'text' ? item.text : item.type === 'image' ? item.alt || 'Image' : 'Drawing'
  return `${item.type[0].toUpperCase() + item.type.slice(1)} · ${value.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Untitled'}`
}

function NotesEditor({ initial, onCommit }: { initial: string; onCommit: (value: string) => void }) {
  const [value, setValue] = useState(initial)
  return <textarea className="story-notes-input" value={value} onChange={event => setValue(event.target.value)} onBlur={() => { if (value !== initial) onCommit(value) }} placeholder="Notes for the speaker view…" aria-label="Speaker notes" />
}

type Props = {
  board: Board
  viewport: Viewport
  activeStoryId: Id | null
  onStoryChange: (id: Id | null) => void
  onPresent: (id: Id) => void
  onClose: () => void
  onFocusFrame: (id: Id, bounds?: Transform) => void
}

export function StoryPanel({ board, viewport, activeStoryId, onStoryChange, onPresent, onClose, onFocusFrame }: Props) {
  const [activeStepId, setActiveStepId] = useState<Id | null>(null)
  const [adding, setAdding] = useState(false)
  const [inspector, setInspector] = useState<'reveal' | 'notes' | null>(null)
  const [storyMenu, setStoryMenu] = useState(false)
  const [renamingStoryId, setRenamingStoryId] = useState<Id | null>(null)
  const exportingRef = useRef(false)
  const [exporting, setExporting] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const addButton = useRef<HTMLButtonElement>(null)
  const stories = Object.values(board.stories)
  const story = (activeStoryId && board.stories[activeStoryId]) || stories[0]
  const order = useMemo(() => frameOrder(board), [board.frames, board.frameEdges])
  const activeStep = story?.steps.find(step => step.id === activeStepId)
  const frame = activeStep && board.frames[activeStep.frameId]
  const itemBounds = activeStep?.viewport || frame?.bounds
  const frameItems = itemBounds ? Object.values(board.items).filter(item => {
    const a = item.transform, b = itemBounds
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  }) : []

  useEffect(() => {
    if (!adding) return
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target as Element).closest('.story-add-menu, .story-add')) setAdding(false)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    return () => window.removeEventListener('pointerdown', closeOutside, true)
  }, [adding])

  const createStory = () => {
    const id = uid()
    const title = stories.length ? `Story ${stories.length + 1}` : 'My story'
    boardState().change(board => { board.stories[id] = { id, title, steps: [] } })
    onStoryChange(id)
    setActiveStepId(null)
  }
  const createFromFrames = () => {
    const id = uid()
    boardState().change(board => { board.stories[id] = { id, title: 'Frame walkthrough', steps: order.map(frame => ({ id: uid(), frameId: frame.id })) } })
    onStoryChange(id)
    setActiveStepId(null)
  }
  const addStep = (frameId: Id) => {
    if (!story) return
    const id = uid()
    boardState().change(board => { board.stories[story.id].steps.push({ id, frameId }) })
    setActiveStepId(id)
    setAdding(false)
  }
  const removeStep = (id: Id) => {
    if (!story) return
    boardState().change(board => { board.stories[story.id].steps = board.stories[story.id].steps.filter(step => step.id !== id) })
    setActiveStepId(null)
  }
  const moveStep = (id: Id, direction: -1 | 1) => {
    if (!story) return
    boardState().change(board => {
      const steps = board.stories[story.id].steps
      const index = steps.findIndex(step => step.id === id)
      const next = index + direction
      if (next >= 0 && next < steps.length) [steps[index], steps[next]] = [steps[next], steps[index]]
    })
  }
  const captureView = (step: StoryStep) => {
    if (!story) return
    const topLeft = screenToWorld(0, 0, viewport)
    const width = window.innerWidth / viewport.zoom
    const height = window.innerHeight / viewport.zoom
    boardState().change(board => { const target = board.stories[story.id].steps.find(value => value.id === step.id); if (target) target.viewport = { ...topLeft, width, height } })
  }
  const resetView = (step: StoryStep) => {
    if (!story) return
    boardState().change(board => { const target = board.stories[story.id].steps.find(value => value.id === step.id); if (target) delete target.viewport })
  }
  const rename = () => {
    if (!story) return
    setStoryMenu(false)
    setRenamingStoryId(story.id)
  }
  const duplicateStory = () => {
    if (!story) return
    const id = uid()
    boardState().change(board => { board.stories[id] = { id, title: `${story.title} copy`, steps: story.steps.map(step => ({ ...structuredClone(isDraft(step) ? current(step) : step), id: uid() })) } })
    onStoryChange(id)
    setStoryMenu(false)
    setActiveStepId(null)
  }
  const deleteStory = () => {
    if (!story || !window.confirm(`Delete “${story.title}”? Board content will stay in place.`)) return
    const next = stories.find(entry => entry.id !== story.id)?.id || null
    boardState().change(board => { delete board.stories[story.id] })
    onStoryChange(next)
    setStoryMenu(false)
    setActiveStepId(null)
  }
  const cycleItem = (id: Id) => {
    if (!story || !activeStep) return
    boardState().change(board => {
      const step = board.stories[story.id].steps.find(value => value.id === activeStep.id)!
      const reveal = step.revealItems || []
      const base = step.visibleItems || Object.keys(board.items).filter(value => !reveal.includes(value))
      if (base.includes(id)) { step.visibleItems = base.filter(value => value !== id); step.revealItems = [...reveal, id] }
      else if (reveal.includes(id)) { step.visibleItems = base; step.revealItems = reveal.filter(value => value !== id) }
      else { step.visibleItems = [...base, id]; step.revealItems = reveal }
    })
  }
  const moveReveal = (id: Id, direction: -1 | 1) => {
    if (!story || !activeStep) return
    boardState().change(board => {
      const list = board.stories[story.id].steps.find(value => value.id === activeStep.id)!.revealItems
      if (!list) return
      const index = list.indexOf(id), next = index + direction
      if (index >= 0 && next >= 0 && next < list.length) [list[index], list[next]] = [list[next], list[index]]
    })
  }
  const exportStory = async (format: 'html' | 'pdf') => {
    if (!story || exportingRef.current) return
    exportingRef.current = true
    const snapshot = boardState().board
    const snapshotStory = snapshot.stories[story.id] || story
    setExporting(true)
    let target: Window | undefined
    try {
      if (format === 'pdf') target = openPrintWindow()
      const module = await import('./exportStory')
      if (target) await module.exportStoryPdf(snapshot, snapshotStory, target)
      else await module.exportStoryHtml(snapshot, snapshotStory)
    } catch (error) {
      target?.close()
      window.alert(`Could not export ${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`)
    }
    finally { exportingRef.current = false; setExporting(false) }
  }

  return <div className="story-panel">
    <div className="story-panel-head"><span className="story-label">STORY</span>{story ? <>{renamingStoryId === story.id ? <InlineRename key={story.id} value={story.title} label="Story title" className="story-title-input" onCommit={title => boardState().change(board => { if (board.stories[story.id]) board.stories[story.id].title = title })} onClose={() => setRenamingStoryId(null)} /> : <select aria-label="Current story" value={story.id} onChange={event => { onStoryChange(event.target.value); setActiveStepId(null); setInspector(null) }}>{stories.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select>}<button className="story-icon" title="Rename story" onClick={rename}>✎</button><div className="story-menu-anchor"><button className="story-icon" title="Story actions" onClick={() => setStoryMenu(value => !value)}><Ellipsis size={16} /></button>{storyMenu && <div className="story-menu"><button onClick={duplicateStory}><Copy size={14} /> Duplicate story</button><button onClick={deleteStory}><Trash2 size={14} /> Delete story</button></div>}</div></> : <span className="story-empty-title">Choose a sequence of frames</span>}<button className="story-icon" title="New story" onClick={createStory}><Plus size={16} /></button><span className="story-panel-spacer" />{story && <button className="story-export" disabled={!story.steps.length || exporting} onClick={() => void exportStory('html')}><Download size={14} /> {exporting ? 'Exporting…' : 'HTML'}</button>}{story && <button className="story-export" disabled={!story.steps.length || exporting} onClick={() => void exportStory('pdf')}><Printer size={14} /> PDF</button>}{story && <button className="story-present" disabled={!story.steps.length} onClick={() => onPresent(story.id)}><Play size={15} fill="currentColor" /> Present</button>}<button className="story-icon" title="Close story editor" onClick={onClose}><X size={18} /></button></div>
    {!story ? <div className="story-start"><p>A story references frames on this board. It can revisit a frame without copying its contents.</p><div><button onClick={createStory}>New empty story</button>{order.length > 0 && <button onClick={createFromFrames}>Use current frame order</button>}</div></div> : <>
      <div className="story-steps">{story.steps.map((step, index) => <div key={step.id} className="story-step-wrap"><button className={`story-step ${activeStep?.id === step.id ? 'active' : ''}`} onClick={() => { setActiveStepId(step.id); onFocusFrame(step.frameId, step.viewport) }}><small>{String(index + 1).padStart(2, '0')}</small><span>{board.frames[step.frameId]?.title || 'Missing frame'}</span>{step.viewport && <i title="Custom camera">◈</i>}</button><span className="story-arrow">→</span></div>)}<div className="story-add-wrap"><button ref={addButton} className="story-add" onClick={() => { const rect = addButton.current?.getBoundingClientRect(); if (rect) setMenuPosition({ left: rect.left, top: Math.max(10, rect.top - Math.min(240, order.length * 32 + 16) - 8) }); setAdding(value => !value) }}><Plus size={15} /> Add frame</button></div></div>
      {adding && createPortal(<div className="story-add-menu" style={{ position: 'fixed', left: menuPosition.left, top: menuPosition.top, bottom: 'auto', zIndex: 50 }}>{order.length ? order.map(frame => <button key={frame.id} onClick={() => addStep(frame.id)}>{frame.title || 'Untitled region'}</button>) : <span>Draw a frame first</span>}</div>, document.body)}
      {activeStep && <><div className="story-step-actions"><span>{board.frames[activeStep.frameId]?.title || 'Missing frame'}</span><button title="Move earlier" onClick={() => moveStep(activeStep.id, -1)}><ArrowLeft size={14} /></button><button title="Move later" onClick={() => moveStep(activeStep.id, 1)}><ArrowRight size={14} /></button><button onClick={() => captureView(activeStep)}>Use current view</button>{activeStep.viewport && <button onClick={() => resetView(activeStep)}>Fit frame</button>}<button className={inspector === 'reveal' ? 'active' : ''} onClick={() => setInspector(inspector === 'reveal' ? null : 'reveal')}>Reveal{activeStep.revealItems?.length ? ` (${activeStep.revealItems.length})` : ''}</button><button className={inspector === 'notes' ? 'active' : ''} onClick={() => setInspector(inspector === 'notes' ? null : 'notes')}><FileText size={13} /> Notes</button><button className="story-delete" title="Remove step" onClick={() => removeStep(activeStep.id)}><Trash2 size={14} /></button></div>
        {inspector === 'notes' && <div className="story-inspector"><NotesEditor key={activeStep.id} initial={activeStep.notes || ''} onCommit={value => boardState().change(board => { const target = board.stories[story.id].steps.find(step => step.id === activeStep.id); if (target) target.notes = value })} /><span className="story-inspector-hint">Shown in Reveal speaker view · press S while presenting</span></div>}
        {inspector === 'reveal' && <div className="story-inspector"><div className="story-inspector-hint">Items touching this {activeStep.viewport ? 'view' : 'frame'}. Click status to cycle: visible → reveal → hidden.</div><div className="story-item-list">{frameItems.length ? frameItems.map(item => { const order = activeStep.revealItems?.indexOf(item.id) ?? -1; const status = activeStep.visibleItems?.includes(item.id) || (!activeStep.visibleItems && order < 0) ? 'Visible' : order >= 0 ? `Reveal ${order + 1}` : 'Hidden'; return <div className="story-item-row" key={item.id}><span title={itemLabel(item)}>{itemLabel(item)}</span><button className={status === 'Hidden' ? 'muted' : ''} onClick={() => cycleItem(item.id)}>{status}</button>{order >= 0 && <><button title="Reveal earlier" onClick={() => moveReveal(item.id, -1)}><ArrowLeft size={13} /></button><button title="Reveal later" onClick={() => moveReveal(item.id, 1)}><ArrowRight size={13} /></button></>}</div> }) : <span className="story-inspector-hint">No items touch this region.</span>}</div></div>}
      </>}
    </>}
  </div>
}
