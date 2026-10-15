/**
 * The editor reports changes after a short debounce, so whatever ends an edit (Esc, a click elsewhere, switching
 * boards) must first pull the editor's latest content into the board, or the last moments of typing are lost.
 */
let flush: (() => void) | null = null
export const setEditorFlush = (next: (() => void) | null) => { flush = next }
export const flushEditor = () => flush?.()
