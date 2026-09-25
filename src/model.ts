export type Id = string
export type Transform = { x: number; y: number; width: number; height: number; rotation?: number }
export type StrokePoint = { x: number; y: number; pressure?: number }
type BaseItem = { id: Id; transform: Transform }
export type TextItem = BaseItem & { type: 'text'; text: string; fontSize: number; bold?: boolean }
export type CodeItem = BaseItem & { type: 'code'; code: string; language: string }
export type FormulaItem = BaseItem & { type: 'formula'; latex: string }
export type ImageItem = BaseItem & { type: 'image'; assetId: Id; alt?: string }
export type DrawingItem = BaseItem & { type: 'drawing'; points: StrokePoint[]; lineWidth: number }
export type CanvasItem = TextItem | CodeItem | FormulaItem | ImageItem | DrawingItem
export type Frame = { id: Id; title?: string; bounds: Transform }
export type FrameEdge = { id: Id; from: Id; to: Id }
export type StoryStep = { id: Id; frameId: Id; viewport?: Transform; visibleItems?: Id[]; revealItems?: Id[]; notes?: string }
export type Story = { id: Id; title: string; steps: StoryStep[] }
export type Board = { id: Id; version: number; title: string; items: Record<Id, CanvasItem>; frames: Record<Id, Frame>; frameEdges: Record<Id, FrameEdge>; stories: Record<Id, Story> }
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
