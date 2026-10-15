import type { Board } from './model'
import { uid } from './model'
import { loadAsset, saveAsset } from './storage'

const FORMAT = 'trace/board-backup'
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** The whole board with its images, as one JSON file the person can keep outside the browser. */
export async function createBackup(board: Board): Promise<Blob> {
  const assets: Record<string, string> = {}
  for (const item of Object.values(board.items)) {
    if (item.type !== 'image' || assets[item.assetId]) continue
    const blob = await loadAsset(item.assetId)
    if (blob) assets[item.assetId] = await dataUrl(blob)
  }
  return new Blob([JSON.stringify({ format: FORMAT, version: 1, board, assets })], { type: 'application/json' })
}

export function downloadBackup(board: Board, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${board.title.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'board'}.trace.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Parses a backup into a new board (fresh id, so nothing existing is overwritten) and stores its images. */
export async function restoreBackup(text: string): Promise<Board> {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('This file is not a Trace backup.') }
  if (!isRecord(parsed) || parsed.format !== FORMAT || parsed.version !== 1 || !isRecord(parsed.board)) throw new Error('This file is not a Trace backup.')
  const board = parsed.board as unknown as Board
  if (!isRecord(board.items) || !isRecord(board.frames) || !isRecord(board.frameEdges) || !isRecord(board.stories)) throw new Error('The backup is incomplete.')
  for (const item of Object.values(board.items)) {
    if (!isRecord(item) || typeof item.id !== 'string' || !isRecord(item.transform)) throw new Error('The backup contains an invalid item.')
    if (item.type === 'drawing' && (!Array.isArray(item.points) || item.points.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y)))) throw new Error('The backup contains an invalid stroke.')
  }
  const assets = isRecord(parsed.assets) ? parsed.assets : {}
  for (const [id, source] of Object.entries(assets)) {
    const match = typeof source === 'string' && /^data:(image\/[\w.+-]+);base64,(.*)$/.exec(source)
    if (!match) continue
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0))
    await saveAsset(id, new Blob([bytes], { type: match[1] }))
  }
  return { ...board, id: uid(), version: 2, title: `${board.title || 'Board'} (imported)` }
}
