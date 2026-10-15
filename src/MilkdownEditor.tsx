import { useEffect, useRef } from 'react'
import { CrepeBuilder } from '@milkdown/crepe/builder'
import { codeMirror } from '@milkdown/crepe/feature/code-mirror'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { latex } from '@milkdown/crepe/feature/latex'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { table } from '@milkdown/crepe/feature/table'
import { editorViewCtx } from '@milkdown/kit/core'
import { Selection, TextSelection } from '@milkdown/kit/prose/state'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/classic.css'

export type EditorProps = {
  initial: string
  focusPoint: { x: number; y: number } | null
  onChange: (markdown: string) => void
  onDone: () => void
  onReady: (host: HTMLElement) => void
}

/** What-you-see-is-what-you-get Markdown editing: formatting, math and code render as they are typed. */
export default function MilkdownEditor({ initial, focusPoint, onChange, onDone, onReady }: EditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef({ onChange, onDone, onReady })
  latest.current = { onChange, onDone, onReady }

  useEffect(() => {
    let disposed = false
    let created = false
    const crepe = new CrepeBuilder({ root: host.current!, defaultValue: initial })
      .addFeature(listItem).addFeature(codeMirror).addFeature(table).addFeature(cursor)
      .addFeature(latex, { katexOptions: { throwOnError: false, trust: false } })
    crepe.on(listener => listener.markdownUpdated((_, markdown) => { if (!disposed) latest.current.onChange(markdown) }))
    void crepe.create().then(() => {
      created = true
      if (disposed) { void crepe.destroy(); return }
      crepe.editor.action(ctx => {
        const view = ctx.get(editorViewCtx)
        const { doc } = view.state
        const first = doc.firstChild
        let selection: Selection
        if (doc.childCount === 1 && first?.type.name === 'code_block' && !first.textContent) selection = TextSelection.create(doc, 1) // a freshly inserted, empty code or formula block
        else {
          const at = focusPoint && view.posAtCoords({ left: focusPoint.x, top: focusPoint.y })
          selection = at ? Selection.near(doc.resolve(at.pos)) : Selection.atEnd(doc)
        }
        view.dispatch(view.state.tr.setSelection(selection))
        view.focus()
      })
      latest.current.onReady(host.current!)
    }).catch(error => console.error('Markdown editor could not open', error))
    return () => { disposed = true; if (created) void crepe.destroy() }
    // The editor owns the document while the note is being edited.
  }, [])

  return <div ref={host} className="markdown-wysiwyg" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) { event.preventDefault(); latest.current.onDone() }
  }} />
}
