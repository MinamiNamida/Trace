import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { TextItem } from './model'

const markdownPlugins = [remarkGfm, remarkMath]
const MarkdownPreview = memo(({ text }: { text: string }) => <ReactMarkdown remarkPlugins={markdownPlugins} rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false }]]}>{text}</ReactMarkdown>)

function measuredTextHeight(node: HTMLElement) {
  const container = node.closest<HTMLElement>('.canvas-item.text')
  const style = container ? getComputedStyle(container) : null
  const padding = style ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) : 0
  return Math.ceil(node.scrollHeight + padding + 2)
}

// Old boards stored literal text rather than Markdown.
function legacyToMarkdown(text: string) {
  return text.split('\n').map(line => line.replace(/([\\`*_{}\[\]<>#!|~])/g, '\\$1')).join('  \n')
}

// Earlier editors emitted HTML line breaks and escaped math delimiters.
function normalizeMarkdown(text: string) {
  return text.replace(/<br\s*\/?\s*>/gi, '  \n').replace(/(^|[^\\])\\\$/g, (_, before: string) => `${before}$`)
}

function caretAtPoint(editable: HTMLElement, point: { x: number; y: number } | null) {
  if (!point) return
  const documentWithCaret = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let range = documentWithCaret.caretRangeFromPoint?.(point.x, point.y) ?? null
  if (!range) {
    const caret = documentWithCaret.caretPositionFromPoint?.(point.x, point.y)
    if (caret) { range = document.createRange(); range.setStart(caret.offsetNode, caret.offset) }
  }
  if (!range || !editable.contains(range.startContainer)) return
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function MarkdownTextEditor({ initial, focusPoint, onChange, onDone, onHeightChange }: { initial: string; focusPoint: { x: number; y: number } | null; onChange: (value: string) => void; onDone: () => void; onHeightChange?: (height: number) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  const onDoneRef = useRef(onDone)
  const onHeightRef = useRef(onHeightChange)
  onChangeRef.current = onChange
  onDoneRef.current = onDone
  onHeightRef.current = onHeightChange
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState(initial)

  useEffect(() => {
    let disposed = false
    let ready = false
    let editor: import('vditor').default | undefined
    let observer: ResizeObserver | undefined
    void import('vditor').then(({ default: Vditor }) => {
      if (disposed || !host.current) return
      const cdn = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/vditor`
      editor = new Vditor(host.current, {
        mode: 'ir',
        value: initial,
        cdn,
        cache: { enable: false },
        toolbar: [],
        toolbarConfig: { hide: true },
        height: 'auto',
        minHeight: 32,
        preview: { math: { engine: 'KaTeX', inlineDigit: true }, hljs: { enable: false }, markdown: { sanitize: true } },
        input: value => { const next = normalizeMarkdown(value); setDraft(next); onChangeRef.current(next) },
        ctrlEnter: () => onDoneRef.current(),
        after: () => {
          ready = true
          if (disposed) { editor?.destroy(); return }
          if (!host.current) return
          const editable = host.current.querySelector<HTMLElement>('.vditor-ir [contenteditable="true"]')
          const measure = () => { if (host.current) onHeightRef.current?.(measuredTextHeight(host.current)) }
          observer = new ResizeObserver(measure)
          observer.observe(host.current)
          measure()
          editable?.focus()
          requestAnimationFrame(() => { if (editable?.isConnected) caretAtPoint(editable, focusPoint) })
        },
      })
    }).catch(error => { console.error('Markdown editor could not open', error); if (!disposed) setFailed(true) })
    return () => { disposed = true; observer?.disconnect(); if (ready) editor?.destroy() }
    // Vditor owns its document while the note is being edited.
  }, [])

  return <div className="markdown-text-editor" onKeyDown={event => event.stopPropagation()}>
    {failed ? <textarea autoFocus spellCheck={false} aria-label="Markdown source" value={draft} onChange={event => { const next = normalizeMarkdown(event.target.value); setDraft(next); onChange(next) }} /> : <div ref={host} className="markdown-vditor" />}
  </div>
}

export function MarkdownText({ item, editing, onChange, onDone, onHeightChange }: { item: TextItem; editing: boolean; onChange: (value: string) => void; onDone: () => void; onHeightChange?: (height: number) => void }) {
  const preview = useRef<HTMLDivElement>(null)
  const focusPoint = useRef<{ x: number; y: number } | null>(null)
  const onHeightRef = useRef(onHeightChange)
  onHeightRef.current = onHeightChange
  const heightRef = useRef(item.transform.height)
  heightRef.current = item.transform.height

  useEffect(() => {
    if (!item.markdown || !preview.current || !onHeightRef.current) return
    const node = preview.current
    const measure = () => {
      const needed = measuredTextHeight(node)
      if (needed > heightRef.current + 1) onHeightRef.current?.(needed)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [item.markdown, item.text, item.fontSize, item.transform.width])

  const markdown = item.markdown ? normalizeMarkdown(item.text) : legacyToMarkdown(item.text)
  return <div className="markdown-text-shell" style={{ fontSize: item.fontSize, fontWeight: item.bold ? 600 : 400 }} onPointerDownCapture={event => { if (!editing) focusPoint.current = { x: event.clientX, y: event.clientY } }}>
    <div ref={preview} className={`text-content ${item.markdown ? 'markdown-prose' : 'legacy-text'} ${editing ? 'text-measure' : ''}`}>
      {item.markdown ? <MarkdownPreview text={markdown} /> : item.text}
    </div>
    {editing && <MarkdownTextEditor initial={markdown} focusPoint={focusPoint.current} onChange={onChange} onDone={onDone} onHeightChange={onHeightChange} />}
  </div>
}
