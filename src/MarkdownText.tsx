import { memo, useEffect, useRef, useState, type ComponentType } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { highlightCode } from './highlight'
import type { TextItem } from './model'
import type { EditorProps } from './MilkdownEditor'

const markdownPlugins = [remarkGfm, remarkMath]
// Fenced code is rendered with the same highlighter and chrome wherever a note is shown.
const markdownComponents: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const text = String(children)
    const language = /language-([\w+#-]+)/.exec(className || '')?.[1]
    if (!language && !text.includes('\n')) return <code>{children}</code>
    if (language?.toLowerCase() === 'latex') return <div className="latex-block">{children}</div>
    return <div className="code-block"><div className="code-toolbar"><span>{language ?? 'text'}</span></div><pre><code className="hljs" dangerouslySetInnerHTML={{ __html: highlightCode(text.replace(/\n$/, ''), language) }} /></pre></div>
  },
}
const MarkdownPreview = memo(({ text }: { text: string }) => <ReactMarkdown remarkPlugins={markdownPlugins} rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false }]]} components={markdownComponents}>{text}</ReactMarkdown>)

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

function MarkdownTextEditor({ initial, focusPoint, onChange, onDone, onHeightChange, onReady }: { initial: string; focusPoint: { x: number; y: number } | null; onChange: (value: string) => void; onDone: () => void; onHeightChange?: (height: number) => void; onReady: () => void }) {
  const onHeightRef = useRef(onHeightChange)
  onHeightRef.current = onHeightChange
  const observer = useRef<ResizeObserver>(null)
  const [Editor, setEditor] = useState<ComponentType<EditorProps> | null>(null)
  const [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState(initial)

  useEffect(() => {
    let active = true
    import('./MilkdownEditor').then(module => { if (active) setEditor(() => module.default) }).catch(error => { console.error('Markdown editor could not open', error); if (active) { setFailed(true); onReady() } })
    return () => { active = false; observer.current?.disconnect() }
  }, [])

  const ready = (host: HTMLElement) => {
    // Measure the content itself, not the box that is stretched to fill the note.
    const content = host.querySelector<HTMLElement>('.ProseMirror') ?? host
    const measure = () => { if (content.scrollHeight) onHeightRef.current?.(measuredTextHeight(content)) }
    observer.current = new ResizeObserver(measure)
    observer.current.observe(content)
    measure()
    onReady()
  }
  const change = (value: string) => { const next = normalizeMarkdown(value); setDraft(next); onChange(next) }

  return <div className="markdown-text-editor" onKeyDown={event => event.stopPropagation()} onMouseDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); event.currentTarget.querySelector<HTMLElement>('.ProseMirror')?.focus() } }}>
    {failed
      ? <textarea autoFocus spellCheck={false} aria-label="Markdown source" value={draft} onChange={event => change(event.target.value)} />
      : Editor && <Editor initial={initial} focusPoint={focusPoint} onChange={change} onDone={onDone} onReady={ready} />}
  </div>
}

export function MarkdownText({ item, editing, onChange, onDone, onHeightChange }: { item: TextItem; editing: boolean; onChange: (value: string) => void; onDone: () => void; onHeightChange?: (height: number) => void }) {
  const preview = useRef<HTMLDivElement>(null)
  const focusPoint = useRef<{ x: number; y: number } | null>(null)
  const [editorReady, setEditorReady] = useState(false)
  useEffect(() => { if (!editing) setEditorReady(false) }, [editing])
  const onHeightRef = useRef(onHeightChange)
  onHeightRef.current = onHeightChange
  const heightRef = useRef(item.transform.height)
  heightRef.current = item.transform.height

  useEffect(() => {
    // While editing, the editor measures its own content; measuring both would make them chase each other.
    if (!item.markdown || editing || !preview.current || !onHeightRef.current) return
    const node = preview.current
    const measure = () => {
      if (!node.scrollHeight) return // not laid out (hidden or detached): nothing to fit to
      const needed = measuredTextHeight(node)
      if (Math.abs(needed - heightRef.current) > 1) onHeightRef.current?.(needed)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [item.markdown, item.text, item.fontSize, item.transform.width, editing])

  const markdown = item.markdown ? normalizeMarkdown(item.text) : legacyToMarkdown(item.text)
  return <div className="markdown-text-shell" style={{ fontSize: item.fontSize, fontWeight: item.bold ? 600 : 400 }} onPointerDownCapture={event => { if (!editing) focusPoint.current = { x: event.clientX, y: event.clientY } }}>
    <div ref={preview} className={`text-content ${item.markdown ? 'markdown-prose' : 'legacy-text'} ${editing && editorReady ? 'text-measure' : ''}`}>
      {item.markdown ? <MarkdownPreview text={markdown} /> : item.text}
    </div>
    {editing && <MarkdownTextEditor initial={markdown} focusPoint={focusPoint.current} onChange={onChange} onDone={onDone} onHeightChange={onHeightChange} onReady={() => setEditorReady(true)} />}
  </div>
}
