import { fitBounds } from './model'
import type { Board, Id, StoryStep, Viewport } from './model'

export function cameraFor(board: Board, step: StoryStep, width: number, height: number): Viewport {
  const bounds = step.viewport || board.frames[step.frameId]?.bounds
  return bounds ? fitBounds(bounds, width, height, step.viewport ? 0 : 100) : { x: 0, y: 0, zoom: 1 }
}

export function stepBaseItems(board: Board, step: StoryStep): Id[] {
  const reveal = new Set(step.revealItems || [])
  return (step.visibleItems || Object.keys(board.items)).filter(id => !!board.items[id] && !reveal.has(id))
}

export function visibleItemsForStep(board: Board, step: StoryStep, revealed: number): Id[] | undefined {
  if (!step.visibleItems && !step.revealItems?.length) return undefined
  return [...new Set([...stepBaseItems(board, step), ...(step.revealItems || []).slice(0, revealed).filter(id => !!board.items[id])])]
}
