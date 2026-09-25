import { useEffect, useRef, useState } from 'react'

type Props = {
  value: string
  label: string
  className?: string
  onCommit: (value: string) => void
  onClose: () => void
}

export function InlineRename({ value, label, className, onCommit, onClose }: Props) {
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement>(null)
  const finished = useRef(false)

  useEffect(() => { input.current?.focus(); input.current?.select() }, [])

  const finish = (save: boolean) => {
    if (finished.current) return
    finished.current = true
    const next = draft.trim()
    if (save && next && next !== value) onCommit(next)
    onClose()
  }

  return <input
    ref={input}
    className={className}
    aria-label={label}
    value={draft}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => finish(true)}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Enter') { event.preventDefault(); finish(true) }
      if (event.key === 'Escape') { event.preventDefault(); finish(false) }
    }}
  />
}
