import type { BoardClip } from './boardOperations'
import { loadAsset, saveAsset } from './storage'
import { migrateLegacyItem, uid } from './model'

let localClip: BoardClip | null = null
export const rememberClip = (clip: BoardClip) => { localClip = structuredClone(clip) }
export const recalledClip = () => localClip && structuredClone(localClip)
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})
export async function writeClip(clip: BoardClip) {
  rememberClip(clip)
  const assets: Record<string, string> = {}
  await Promise.all(clip.items.filter(item => item.type === 'image').map(async item => {
    if (item.type !== 'image') return
    const blob = await loadAsset(item.assetId)
    if (blob) assets[item.assetId] = await dataUrl(blob)
  }))
  const complete = { ...clip, assets }
  rememberClip(complete)
  await navigator.clipboard.writeText(JSON.stringify(complete))
}
export function parseClip(text: string): BoardClip | null {
  try {
    const clip = JSON.parse(text)
    if (clip.kind !== 'trace/selection' || clip.version !== 1 || !Array.isArray(clip.items) || !Array.isArray(clip.frames) || !Array.isArray(clip.edges)) return null
    const objects = [...clip.items, ...clip.frames]
    if (!objects.length || objects.length > 10000 || new Set(objects.map(object => object.id)).size !== objects.length) return null
    const validBounds = (bounds: { x: number; y: number; width: number; height: number }) => bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0
    if (objects.some(object => typeof object.id !== 'string' || (object.groupIds && (!Array.isArray(object.groupIds) || object.groupIds.some((id: unknown) => typeof id !== 'string'))))) return null
    if (clip.frames.some((frame: BoardClip['frames'][number]) => !validBounds(frame.bounds) || 'transform' in frame || (frame.title !== undefined && typeof frame.title !== 'string'))) return null
    for (const item of clip.items) {
      if (!validBounds(item.transform) || (item.frameId !== undefined && typeof item.frameId !== 'string')) return null
      if (item.type === 'text' && (typeof item.text !== 'string' || !Number.isFinite(item.fontSize))) return null
      else if (item.type === 'code' && (typeof item.code !== 'string' || typeof item.language !== 'string')) return null
      else if (item.type === 'formula' && typeof item.latex !== 'string') return null
      else if (item.type === 'image' && typeof item.assetId !== 'string') return null
      else if (item.type === 'drawing' && (!Array.isArray(item.points) || !Number.isFinite(item.lineWidth) || item.points.some((point: { x: number; y: number }) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) return null
      else if (!['text', 'code', 'formula', 'image', 'drawing'].includes(item.type)) return null
    }
    if (clip.edges.some((edge: BoardClip['edges'][number]) => typeof edge.id !== 'string' || typeof edge.from !== 'string' || typeof edge.to !== 'string')) return null
    if (clip.assets && (typeof clip.assets !== 'object' || Object.values(clip.assets).some(value => typeof value !== 'string' || !/^data:image\/[\w.+-]+;base64,/.test(value)))) return null
    clip.items = clip.items.map(migrateLegacyItem)
    return clip
  } catch { return null }
}
export async function restoreClipAssets(clip: BoardClip) {
  const restored = structuredClone(clip)
  const replacements = new Map<string, string>()
  for (const item of restored.items) if (item.type === 'image' && clip.assets?.[item.assetId]) {
    if (!replacements.has(item.assetId)) {
      const source = clip.assets[item.assetId]
      const [header, encoded] = source.split(',')
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
      const id = uid()
      await saveAsset(id, new Blob([bytes], { type: header.slice(5, header.indexOf(';')) }))
      replacements.set(item.assetId, id)
    }
    item.assetId = replacements.get(item.assetId)!
  }
  return restored
}
