import type { Board } from './model'

export type SaveStatus = 'saving' | 'saved' | 'failed'
type Options = {
  save: (board: Board) => Promise<void>
  onStatus: (status: SaveStatus) => void
  /** While true (e.g. a stroke is in progress) the write is postponed, never the input. */
  hold?: () => boolean
  delay?: number
  holdDelay?: number
  retryDelays?: number[]
}

/**
 * Debounced, serialized persistence. Only the latest snapshot is ever written, at most one
 * write is in flight, and a failed write is retried unless a newer snapshot supersedes it.
 */
export function createAutosave({ save, onStatus, hold, delay = 450, holdDelay = 200, retryDelays = [1000, 3000, 10000] }: Options) {
  let latest: Board | null = null
  let written: Board | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let failures = 0

  const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(run, ms) }
  async function run(force = false) {
    timer = undefined
    if (!latest || latest === written) return
    if (inFlight) return
    if (!force && hold?.()) { arm(holdDelay); return }
    const snapshot = latest
    inFlight = true
    try {
      await save(snapshot)
      written = snapshot
      failures = 0
      if (latest === snapshot) onStatus('saved')
    } catch {
      onStatus('failed')
      if (latest !== written) arm(retryDelays[Math.min(failures, retryDelays.length - 1)])
      failures++
    } finally {
      inFlight = false
    }
    if (latest !== written && timer === undefined) arm(0)
  }

  return {
    schedule(board: Board) {
      if (board === written) return
      latest = board
      failures = 0
      onStatus('saving')
      arm(delay)
    },
    /** Write the newest snapshot now, even mid-stroke (page hide, board switch). */
    flush() { clearTimeout(timer); return run(true) },
    /** Forget pending work, e.g. when another operation takes over persistence. */
    cancel() { clearTimeout(timer); timer = undefined; latest = null },
  }
}
