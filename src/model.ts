export type Id = string
export type Transform = { x: number; y: number; width: number; height: number; rotation?: number }
export type StrokePoint = { x: number; y: number; pressure?: number; t?: number }
/** Absent on legacy strokes, which keep their original rendering. */
export type PenStyle = { mode: 'ink' | 'technical'; smoothing: number; pressure: boolean; curve: number }
type BaseItem = { id: Id; transform: Transform; groupIds?: Id[]; frameId?: Id }
export type TextItem = BaseItem & { type: 'text'; text: string; fontSize: number; bold?: boolean; markdown?: boolean }
export type ImageItem = BaseItem & { type: 'image'; assetId: Id; alt?: string }
export type DrawingItem = BaseItem & { type: 'drawing'; points: StrokePoint[]; lineWidth: number; pen?: PenStyle }
export type CanvasItem = TextItem | ImageItem | DrawingItem
export type Frame = { id: Id; title?: string; bounds: Transform; groupIds?: Id[] }
export type FrameEdge = { id: Id; from: Id; to: Id }
export type StoryStep = { id: Id; frameId: Id; viewport?: Transform; visibleItems?: Id[]; revealItems?: Id[]; notes?: string }
export type Story = { id: Id; title: string; steps: StoryStep[] }
export type Board = { id: Id; version: number; title: string; items: Record<Id, CanvasItem>; frames: Record<Id, Frame>; frameEdges: Record<Id, FrameEdge>; stories: Record<Id, Story>; frameMembership?: true }
export type Viewport = { x: number; y: number; zoom: number }
export type Tool = 'select' | 'hand' | 'text' | 'code' | 'formula' | 'image' | 'pen' | 'eraser' | 'frame' | 'edge'
export type Selection = { kind: 'item' | 'frame' | 'edge'; id: Id } | null

export const uid = () => crypto.randomUUID()
export const screenToWorld = (x: number, y: number, v: Viewport) => ({ x: (x - v.x) / v.zoom, y: (y - v.y) / v.zoom })
export const worldToScreen = (x: number, y: number, v: Viewport) => ({ x: x * v.zoom + v.x, y: y * v.zoom + v.y })
export const clampZoom = (zoom: number) => Math.max(0.12, Math.min(3, zoom))
export const zoomAt = (v: Viewport, x: number, y: number, zoom: number): Viewport => {
  const world = screenToWorld(x, y, v)
  const z = clampZoom(zoom)
  return { x: x - world.x * z, y: y - world.y * z, zoom: z }
}
export const fitBounds = (bounds: Transform, width: number, height: number, padding = 100): Viewport => {
  const zoom = clampZoom(Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height))
  return { zoom, x: (width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (height - bounds.height * zoom) / 2 - bounds.y * zoom }
}
export const unionBounds = (rects: Transform[]): Transform | null => {
  if (!rects.length) return null
  const x = Math.min(...rects.map(r => r.x))
  const y = Math.min(...rects.map(r => r.y))
  const right = Math.max(...rects.map(r => r.x + r.width))
  const bottom = Math.max(...rects.map(r => r.y + r.height))
  return { x, y, width: right - x, height: bottom - y }
}

/** Code and formula blocks used to be their own item types; they are now Markdown text (a fenced block or `$$`). */
export type LegacyBlock = BaseItem & ({ type: 'code'; code: string; language?: string } | { type: 'formula'; latex: string })
export const markdownForCode = (code: string, language = '') => {
  const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map(match => match[0].length + 1)))
  return `${fence}${language}\n${code}\n${fence}`
}
export function migrateLegacyItem(item: CanvasItem | LegacyBlock): CanvasItem {
  if (item.type === 'code') { const { code, language, type: _type, ...rest } = item; return { ...rest, type: 'text', markdown: true, fontSize: 16, text: markdownForCode(code, language === 'plaintext' ? '' : language) } }
  if (item.type === 'formula') { const { latex, type: _type, ...rest } = item; return { ...rest, type: 'text', markdown: true, fontSize: 20, text: `$$\n${latex}\n$$` } }
  return item
}
/** Returns the same board object when there is nothing to convert, so stored identities are preserved. */
export function migrateLegacyBoard(board: Board): Board {
  const legacy = Object.values(board.items).some(item => (item.type as string) === 'code' || (item.type as string) === 'formula')
  if (!legacy) return board
  return { ...board, items: Object.fromEntries(Object.entries(board.items).map(([id, item]) => [id, migrateLegacyItem(item)])) }
}
/** Text that holds nothing but empty code fences or `$$` pairs counts as empty, so a new block left unused is discarded. */
export const isBlankMarkdown = (text: string) => text.replace(/(`{3,})[\w+#-]*\s*\1|\$\$\s*\$\$/g, '').trim() === ''
