import { memo, useCallback, useEffect, useRef, useState } from 'react'
import katex from 'katex'
import getStroke from 'perfect-freehand'
import { CodeBlock } from './CodeBlock'
import { MarkdownText } from './MarkdownText'
import { selectionBounds } from './boardOperations'
import type { Board, CanvasItem, DrawingItem, Frame, Id, Selection, Transform, Viewport } from './model'
import { loadAsset } from './storage'
import { strokeInput, strokeOptions } from './ink'

const pathCache = new WeakMap<DrawingItem, string>()
export function strokePath(item: DrawingItem) {
  const cached = pathCache.get(item)
  if (cached !== undefined) return cached
  const path = computeStrokePath(item)
  pathCache.set(item, path)
  return path
}
function computeStrokePath(item: DrawingItem) {
  const outline = getStroke(strokeInput(item), strokeOptions(item))
  if (!outline.length) return ''
  const points = outline.map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100])
  return `M ${points[0][0]} ${points[0][1]} ${points.slice(1).map(p => `L ${p[0]} ${p[1]}`).join(' ')} Z`
}

// Re-renders only when its own item object (or visibility) changes, so a stroke being drawn does not repaint the others.
const StrokeShape = memo(function StrokeShape({ item, hidden, onDown }: { item: DrawingItem; hidden: boolean; onDown?: (event: React.PointerEvent, id: Id) => void }) {
  return <g data-item-id={item.id} transform={`translate(${item.transform.x} ${item.transform.y})`} style={hidden ? { visibility: 'hidden' } : undefined} onPointerDown={onDown ? e => onDown(e, item.id) : undefined}>
    <path d={strokePath(item)} fill="#333431" opacity=".88" /><rect width={item.transform.width} height={item.transform.height} fill="transparent" className="drawing-hit" />
  </g>
})

function ImageContent({ assetId, alt, assetUrl }: { assetId: Id; alt?: string; assetUrl?: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let active = true
    let objectUrl = ''
    loadAsset(assetId).then(blob => {
      if (active && blob) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) }
    })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [assetId])
  return assetUrl || url ? <img src={assetUrl || url} alt={alt || ''} draggable={false} /> : <div className="image-loading">Loading image…</div>
}

function FormulaContent({ latex, editing, onChange, onDone }: { latex: string; editing: boolean; onChange: (value: string) => void; onDone: () => void }) {
  let html = ''
  try { html = katex.renderToString(latex || '\\square', { throwOnError: false, displayMode: true, trust: false }) } catch { html = latex }
  if (editing) return <div className="formula-editor">
    <textarea autoFocus spellCheck={false} aria-label="LaTeX formula" placeholder="LaTeX" value={latex} onChange={event => onChange(event.target.value)} onBlur={onDone} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); onDone() } event.stopPropagation() }} />
  </div>
  return <div className="formula-content" dangerouslySetInnerHTML={{ __html: html }} />
}

type Props = {
  board: Board
  viewport: Viewport
  mode: 'edit' | 'readonly'
  visibleItems?: Id[]
  hiddenItems?: Id[]
  assetUrls?: Record<Id, string>
  selection?: Selection
  multiSelection?: Id[]
  editing?: string | null
  onObjectDown?: (event: React.PointerEvent, kind: 'item' | 'frame' | 'edge', id: Id) => void
  onObjectDoubleClick?: (kind: 'item' | 'frame', id: Id) => void
  onResizeDown?: (event: React.PointerEvent, kind: 'item' | 'frame', id: Id) => void
  onEdgeHandleDown?: (event: React.PointerEvent, id: Id) => void
  onContentChange?: (id: Id, value: string) => void
  onTextHeightChange?: (id: Id, height: number) => void
  onCodeLanguageChange?: (id: Id, language: string) => void
  onDoneEditing?: () => void
}

function ItemBody({ item, editing, onContentChange, onCodeLanguageChange, onDoneEditing, onTextHeightChange, assetUrls }: { item: CanvasItem; editing: boolean; onContentChange: (value: string) => void; onCodeLanguageChange: (value: string) => void; onDoneEditing: () => void; onTextHeightChange?: (height: number) => void; assetUrls?: Record<Id, string> }) {
  if (item.type === 'image') return <ImageContent assetId={item.assetId} alt={item.alt} assetUrl={assetUrls?.[item.assetId]} />
  if (item.type === 'formula') return <FormulaContent latex={item.latex} editing={editing} onChange={onContentChange} onDone={onDoneEditing} />
  if (item.type === 'code') return <CodeBlock item={item} editing={editing} onCodeChange={onContentChange} onLanguageChange={onCodeLanguageChange} onDone={onDoneEditing} />
  if (item.type === 'text') return <MarkdownText item={item} editing={editing} onChange={onContentChange} onDone={onDoneEditing} onHeightChange={onTextHeightChange} />
  return null
}

function edgePoints(a: Frame, b: Frame) {
  const ac = { x: a.bounds.x + a.bounds.width / 2, y: a.bounds.y + a.bounds.height / 2 }
  const bc = { x: b.bounds.x + b.bounds.width / 2, y: b.bounds.y + b.bounds.height / 2 }
  const vertical = Math.abs(bc.y - ac.y) > Math.abs(bc.x - ac.x)
  if (vertical) {
    const down = bc.y > ac.y
    return { x1: ac.x, y1: down ? a.bounds.y + a.bounds.height : a.bounds.y, x2: bc.x, y2: down ? b.bounds.y : b.bounds.y + b.bounds.height, vertical }
  }
  const right = bc.x > ac.x
  return { x1: right ? a.bounds.x + a.bounds.width : a.bounds.x, y1: ac.y, x2: right ? b.bounds.x : b.bounds.x + b.bounds.width, y2: bc.y, vertical }
}

const rectStyle = (t: Transform): React.CSSProperties => ({ left: t.x, top: t.y, width: t.width, height: t.height, transform: t.rotation ? `rotate(${t.rotation}deg)` : undefined })

export function BoardRenderer({ board, viewport, mode, visibleItems, hiddenItems, assetUrls, selection, multiSelection = [], editing, onObjectDown, onObjectDoubleClick, onResizeDown, onEdgeHandleDown, onContentChange, onTextHeightChange, onCodeLanguageChange, onDoneEditing }: Props) {
  const editable = mode === 'edit'
  const downRef = useRef(onObjectDown)
  downRef.current = onObjectDown
  const onStrokeDown = useCallback((event: React.PointerEvent, id: Id) => downRef.current?.(event, 'item', id), [])
  const detail = viewport.zoom < .33 ? 'far' : viewport.zoom < .72 ? 'mid' : 'near'
  const frames = Object.values(board.frames)
  const items = Object.values(board.items).filter(item => !visibleItems || visibleItems.includes(item.id))
  const hidden = new Set(hiddenItems)
  return <div className={`board-world detail-${detail}`} style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`, '--title-scale': Math.max(1, Math.min(2.8, .85 / viewport.zoom)), '--content-opacity': Math.max(.24, Math.min(1, (viewport.zoom - .22) / .55)) } as React.CSSProperties}>
    <svg className="world-svg" overflow="visible">
      <defs><marker id="edge-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M 0 0 L 7 3.5 L 0 7" fill="none" stroke="currentColor" strokeWidth="1" /></marker></defs>
      <g className="edge-layer">{Object.values(board.frameEdges).map(edge => {
        const a = board.frames[edge.from], b = board.frames[edge.to]
        if (!a || !b) return null
        const p = edgePoints(a, b)
        const d = p.vertical
          ? `M ${p.x1} ${p.y1} C ${p.x1} ${(p.y1 + p.y2) / 2}, ${p.x2} ${(p.y1 + p.y2) / 2}, ${p.x2} ${p.y2}`
          : `M ${p.x1} ${p.y1} C ${(p.x1 + p.x2) / 2} ${p.y1}, ${(p.x1 + p.x2) / 2} ${p.y2}, ${p.x2} ${p.y2}`
        return <g key={edge.id} data-edge-id={edge.id} className={`frame-edge ${selection?.id === edge.id ? 'selected' : ''}`}><path d={d} markerEnd="url(#edge-arrow)" /><path className="edge-hit" d={d} onPointerDown={editable ? e => onObjectDown?.(e, 'edge', edge.id) : undefined} /></g>
      })}</g>
      <g className="drawing-layer">{items.filter((i): i is DrawingItem => i.type === 'drawing').map(item => <StrokeShape key={item.id} item={item} hidden={hidden.has(item.id)} onDown={editable ? onStrokeDown : undefined} />)}</g>
      <g className="frame-layer">{frames.map(frame => <rect key={frame.id} data-frame-id={frame.id} className={`frame-outline ${(selection?.kind === 'frame' && selection.id === frame.id) || multiSelection.includes(frame.id) ? 'selected' : ''}`} x={frame.bounds.x} y={frame.bounds.y} width={frame.bounds.width} height={frame.bounds.height} onPointerDown={editable ? e => onObjectDown?.(e, 'frame', frame.id) : undefined} />)}</g>
    </svg>
    <div className="world-dom">
      {items.filter(i => i.type !== 'drawing').map(item => <div key={item.id} data-item-id={item.id} className={`canvas-item ${item.type} ${(selection?.kind === 'item' && selection.id === item.id) || multiSelection.includes(item.id) ? 'selected' : ''} ${editing === item.id ? 'editing' : ''}`} style={{ ...rectStyle(item.transform), visibility: hidden.has(item.id) ? 'hidden' : undefined }} onPointerDown={editable ? e => { if (editing === item.id) e.stopPropagation(); else onObjectDown?.(e, 'item', item.id) } : undefined} onDoubleClick={editable ? () => onObjectDoubleClick?.('item', item.id) : undefined}>
        <ItemBody item={item} editing={editing === item.id} assetUrls={assetUrls} onContentChange={value => onContentChange?.(item.id, value)} onTextHeightChange={onTextHeightChange ? height => onTextHeightChange(item.id, height) : undefined} onCodeLanguageChange={value => onCodeLanguageChange?.(item.id, value)} onDoneEditing={() => onDoneEditing?.()} />
      </div>)}
      {frames.map(frame => <div key={frame.id} data-frame-id={frame.id} className={`frame-title ${(selection?.kind === 'frame' && selection.id === frame.id) || multiSelection.includes(frame.id) ? 'selected' : ''}`} style={{ left: frame.bounds.x, top: frame.bounds.y - 37 }} onPointerDown={editable ? e => { if (editing !== frame.id) onObjectDown?.(e, 'frame', frame.id) } : undefined} onDoubleClick={editable ? () => onObjectDoubleClick?.('frame', frame.id) : undefined}>
        {editing === frame.id ? <input autoFocus value={frame.title || ''} onChange={e => onContentChange?.(frame.id, e.target.value)} onBlur={onDoneEditing} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') onDoneEditing?.(); e.stopPropagation() }} /> : <span>{frame.title || 'Untitled region'}</span>}
        {editable && <button className="frame-connector" title="Drag to connect frames" onPointerDown={e => { e.stopPropagation(); onEdgeHandleDown?.(e, frame.id) }}>↗</button>}
      </div>)}
      {editable && selection && selection.kind !== 'edge' && (() => {
        const t = selection.kind === 'item' ? board.items[selection.id]?.transform : board.frames[selection.id]?.bounds
        if (!t) return null
        return <div className="selection-box" style={rectStyle(t)}><button className="resize-handle" title="Resize" onPointerDown={e => onResizeDown?.(e, selection.kind as 'item' | 'frame', selection.id)} /></div>
      })()}
      {editable && multiSelection.length > 1 && (() => {
        const bounds = selectionBounds(board, multiSelection)
        return bounds ? <div className="selection-box multi-selection-box" style={rectStyle(bounds)} /> : null
      })()}
    </div>
  </div>
}
