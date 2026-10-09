import type { Board } from '../src/model'

export const blank = (id: string): Board => ({ id, version: 2, title: id, items: {}, frames: {}, frameEdges: {}, stories: {} })
export const image = (id: string, assetId: string) => ({ id, type: 'image' as const, assetId, transform: { x: 20, y: 30, width: 100, height: 80 } })
