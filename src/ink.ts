import type { StrokeOptions } from 'perfect-freehand'
import type { DrawingItem, PenStyle, StrokePoint } from './model'

export type PenSettings = PenStyle & { width: number }
export const PEN_PRESETS: Record<PenStyle['mode'], PenSettings> = {
  technical: { mode: 'technical', width: 1.5, smoothing: .2, pressure: false, curve: 1 },
  ink: { mode: 'ink', width: 3, smoothing: 1, pressure: true, curve: 1 },
}
export const MIN_PEN_WIDTH = .25
export const MAX_PEN_WIDTH = 12

/** Maps raw pressure through the user's curve; gamma < 1 makes light touches heavier. */
export const pressureCurve = (pressure: number, curve: number) => Math.pow(Math.min(1, Math.max(0, pressure)), curve)

const hasRealPressure = (item: DrawingItem) => item.pen!.pressure && item.points.some(p => p.pressure !== undefined)

/** Render parameters for one stroke. Legacy strokes (no `pen`) render exactly as before. */
export function strokeOptions(item: DrawingItem): StrokeOptions {
  const pen = item.pen
  if (!pen) return { size: item.lineWidth, thinning: .22, smoothing: .65, streamline: .42, simulatePressure: true }
  const smoothing = Math.min(1, Math.max(0, pen.smoothing))
  const common = { size: item.lineWidth, smoothing: .65 * smoothing, streamline: .42 * smoothing, last: true }
  if (pen.mode === 'technical') return { ...common, thinning: 0, simulatePressure: false }
  return hasRealPressure(item) ? { ...common, thinning: .6, simulatePressure: false } : { ...common, thinning: .22, simulatePressure: true }
}

export function strokeInput(item: DrawingItem): number[][] {
  const curve = item.pen?.curve ?? 1
  return item.points.map(p => [p.x, p.y, p.pressure === undefined ? .5 : pressureCurve(p.pressure, curve)])
}

/** Rejects non-finite, duplicate and out-of-order samples. Never decimates by distance or rate. */
export function acceptSample(last: StrokePoint | undefined, x: number, y: number, t: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return false
  if (!last) return true
  if (last.t !== undefined && t < last.t) return false
  return last.x !== x || last.y !== y
}

/** All hardware samples since the previous event, falling back to the event itself. */
export function samplesOf(event: PointerEvent): PointerEvent[] {
  const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
  return coalesced.length ? coalesced : [event]
}

/** Pressure is only recorded for devices that actually report it. */
export const realPressure = (event: Pick<PointerEvent, 'pointerType' | 'pressure'>) => event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : undefined
