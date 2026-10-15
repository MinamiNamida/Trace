import { expect, test } from 'vitest'
import { acceptSample, pressureCurve, realPressure, samplesOf, strokeInput, strokeOptions } from '../src/ink'
import { strokePath } from '../src/BoardRenderer'
import type { DrawingItem } from '../src/model'

const stroke = (extra: Partial<DrawingItem> = {}): DrawingItem => ({ id: 's', type: 'drawing', lineWidth: 1.5, transform: { x: 0, y: 0, width: 10, height: 10 }, points: [{ x: 0, y: 0, pressure: .2 }, { x: 5, y: 5, pressure: .8 }], ...extra })

test('legacy strokes keep their original render parameters', () => {
  expect(strokeOptions(stroke())).toEqual({ size: 1.5, thinning: .22, smoothing: .65, streamline: .42, simulatePressure: true })
})

test('technical pen is fixed width with no simulated pressure and light smoothing', () => {
  const o = strokeOptions(stroke({ pen: { mode: 'technical', smoothing: .2, pressure: false, curve: 1 } }))
  expect(o).toMatchObject({ thinning: 0, simulatePressure: false, size: 1.5 })
  expect(o.smoothing).toBeLessThan(.2)
})

test('ink separates real pressure from velocity-simulated pressure, and smoothing 0 disables smoothing', () => {
  const pen = { mode: 'ink' as const, smoothing: 0, pressure: true, curve: 1 }
  expect(strokeOptions(stroke({ pen })).simulatePressure).toBe(false)
  const noPressure = stroke({ pen, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] })
  expect(strokeOptions(noPressure).simulatePressure).toBe(true)
  expect(strokeOptions(noPressure)).toMatchObject({ smoothing: 0, streamline: 0 })
  expect(strokeOptions(stroke({ pen: { ...pen, pressure: false } })).simulatePressure).toBe(true)
})

test('pressure curve is applied at render time and does not change stored points', () => {
  const item = stroke({ pen: { mode: 'ink', smoothing: 1, pressure: true, curve: 2 } })
  expect(strokeInput(item).map(p => p[2])).toEqual([.04, .64].map(v => expect.closeTo(v, 5)))
  expect(item.points[0].pressure).toBe(.2)
  expect(pressureCurve(2, 1)).toBe(1)
})

test('samples are validated without decimation', () => {
  const last = { x: 1, y: 1, t: 10 }
  expect(acceptSample(last, 1, 1, 12)).toBe(false)
  expect(acceptSample(last, 2, 1, 9)).toBe(false)
  expect(acceptSample(last, NaN, 1, 12)).toBe(false)
  expect(acceptSample(last, 1.001, 1, 10)).toBe(true)
  expect(acceptSample(undefined, 0, 0, 0)).toBe(true)
})

test('coalesced events are preferred and the event itself is the fallback', () => {
  const a = {} as PointerEvent, b = {} as PointerEvent
  expect(samplesOf({ getCoalescedEvents: () => [a, b] } as unknown as PointerEvent)).toEqual([a, b])
  const plain = {} as PointerEvent
  expect(samplesOf(plain)).toEqual([plain])
  expect(samplesOf({ getCoalescedEvents: () => [] } as unknown as PointerEvent)).toHaveLength(1)
})

test('pressure is only recorded from pens that report it', () => {
  expect(realPressure({ pointerType: 'mouse', pressure: .5 })).toBeUndefined()
  expect(realPressure({ pointerType: 'pen', pressure: 0 })).toBeUndefined()
  expect(realPressure({ pointerType: 'pen', pressure: .3 })).toBe(.3)
})

test('paths keep sub-pixel precision', () => {
  const path = strokePath(stroke({ pen: { mode: 'technical', smoothing: 0, pressure: false, curve: 1 }, points: [{ x: 0.123, y: 0 }, { x: 3.456, y: 0.789 }] }))
  expect(path).toMatch(/\d\.\d\d/)
})
