import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createAutosave, type SaveStatus } from '../src/autosave'
import { useBoard } from '../src/store'
import { blank } from './fixtures'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

const snapshots = () => { const a = blank('a'); return [{ ...a, title: '1' }, { ...a, title: '2' }, { ...a, title: '3' }] }

test('a burst of changes writes only the newest snapshot', async () => {
  const [b1, b2, b3] = snapshots()
  const save = vi.fn(async () => {})
  const auto = createAutosave({ save, onStatus: () => {} })
  auto.schedule(b1); auto.schedule(b2); auto.schedule(b3)
  await vi.advanceTimersByTimeAsync(500)
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith(b3)
})

test('a change made while a write is in flight is saved afterwards, never overwritten by the older one', async () => {
  const [b1, b2] = snapshots()
  const order: string[] = []
  let release!: () => void
  const save = vi.fn((b: { title: string }) => { order.push(b.title); return order.length === 1 ? new Promise<void>(r => { release = r }) : Promise.resolve() })
  const statuses: SaveStatus[] = []
  const auto = createAutosave({ save, onStatus: s => statuses.push(s) })
  auto.schedule(b1)
  await vi.advanceTimersByTimeAsync(500)
  auto.schedule(b2)
  await vi.advanceTimersByTimeAsync(500)
  expect(order).toEqual(['1'])
  release()
  await vi.advanceTimersByTimeAsync(10)
  expect(order).toEqual(['1', '2'])
  expect(statuses.at(-1)).toBe('saved')
})

test('writes are postponed while a stroke is in progress and resume afterwards', async () => {
  const [b1] = snapshots()
  let drawing = true
  const save = vi.fn(async () => {})
  const auto = createAutosave({ save, onStatus: () => {}, hold: () => drawing })
  auto.schedule(b1)
  await vi.advanceTimersByTimeAsync(2000)
  expect(save).not.toHaveBeenCalled()
  drawing = false
  await vi.advanceTimersByTimeAsync(300)
  expect(save).toHaveBeenCalledTimes(1)
})

test('flush writes immediately even mid-stroke', async () => {
  const [b1] = snapshots()
  const save = vi.fn(async () => {})
  const auto = createAutosave({ save, onStatus: () => {}, hold: () => true })
  auto.schedule(b1)
  await auto.flush()
  expect(save).toHaveBeenCalledWith(b1)
})

test('a failed write is retried and reports its status', async () => {
  const [b1] = snapshots()
  const save = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined)
  const statuses: SaveStatus[] = []
  const auto = createAutosave({ save, onStatus: s => statuses.push(s) })
  auto.schedule(b1)
  await vi.advanceTimersByTimeAsync(500)
  expect(statuses.at(-1)).toBe('failed')
  await vi.advanceTimersByTimeAsync(1100)
  expect(save).toHaveBeenCalledTimes(2)
  expect(statuses.at(-1)).toBe('saved')
})

test('cancel drops pending work', async () => {
  const [b1] = snapshots()
  const save = vi.fn(async () => {})
  const auto = createAutosave({ save, onStatus: () => {} })
  auto.schedule(b1); auto.cancel()
  await vi.advanceTimersByTimeAsync(1000)
  expect(save).not.toHaveBeenCalled()
})

test('replaceItem shares untouched items and leaves undo history intact', () => {
  const board = blank('x')
  board.items = {
    a: { id: 'a', type: 'drawing', points: [{ x: 0, y: 0 }], lineWidth: 3, transform: { x: 0, y: 0, width: 1, height: 1 } },
    b: { id: 'b', type: 'drawing', points: [{ x: 0, y: 0 }], lineWidth: 3, transform: { x: 5, y: 5, width: 1, height: 1 } },
  }
  useBoard.getState().setBoard(board)
  const before = useBoard.getState().board
  useBoard.getState().replaceItem({ ...before.items.a, points: [{ x: 0, y: 0 }, { x: 4, y: 4 }] } as never)
  const after = useBoard.getState().board
  expect(after.items.b).toBe(before.items.b)
  expect((before.items.a as { points: unknown[] }).points).toHaveLength(1)
  expect((after.items.a as { points: unknown[] }).points).toHaveLength(2)
})
