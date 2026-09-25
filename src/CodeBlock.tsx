import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import 'highlight.js/styles/github.css'
import type { CodeItem } from './model'

Object.entries({ bash, c, cpp, csharp, css, go, java, javascript, json, markdown, plaintext, python, rust, sql, typescript, xml })
  .forEach(([name, grammar]) => hljs.registerLanguage(name, grammar))

const languages = [
  ['plaintext', 'Plain text'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'],
  ['python', 'Python'], ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'],
  ['csharp', 'C#'], ['go', 'Go'], ['rust', 'Rust'], ['bash', 'Shell'],
  ['json', 'JSON'], ['xml', 'HTML / XML'], ['css', 'CSS'], ['sql', 'SQL'],
  ['markdown', 'Markdown'],
] as const

export function CodeBlock({ item, editing, onCodeChange, onLanguageChange, onDone }: {
  item: CodeItem
  editing: boolean
  onCodeChange: (value: string) => void
  onLanguageChange: (value: string) => void
  onDone: () => void
}) {
  const language = hljs.getLanguage(item.language) ? item.language : 'plaintext'
  const label = languages.find(([id]) => id === item.language)?.[1] || item.language || 'Plain text'
  if (editing) return <div className="code-editor" onDoubleClick={event => event.stopPropagation()} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) onDone()
  }} onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); onDone() }
    event.stopPropagation()
  }}>
    <div className="code-toolbar"><span>CODE</span><select aria-label="Code language" value={item.language} onChange={event => onLanguageChange(event.target.value)}>{!languages.some(([id]) => id === item.language) && <option value={item.language}>{label}</option>}{languages.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
    <textarea autoFocus spellCheck={false} aria-label="Code source" value={item.code} onChange={event => onCodeChange(event.target.value)} placeholder="Write or paste code…" />
  </div>

  const highlighted = hljs.highlight(item.code, { language, ignoreIllegals: true }).value
  return <div className="code-block"><div className="code-toolbar"><span>CODE</span><span>{label}</span></div><pre><code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} /></pre></div>
}
